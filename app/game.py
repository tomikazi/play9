"""Game state, deck, and validation logic."""

from __future__ import annotations

import json
import random
import re
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# Table name: lowercase letters, digits, -, _ only; 20 chars max
TABLE_NAME_RE = re.compile(r"^[a-z0-9_-]{1,20}$")

# Player name: letters, digits, space only; 20 chars max
PLAYER_NAME_RE = re.compile(r"^[a-zA-Z0-9 ]{1,20}$")


def validate_table_name(name: str) -> tuple[bool, str]:
    """Validate table name. Returns (ok, error_message)."""
    sanitized = name.lower().strip()
    if not TABLE_NAME_RE.match(sanitized):
        return False, "Table name: lowercase letters, digits, -, _ only; max 20 characters"
    return True, sanitized


def validate_player_name(name: str) -> tuple[bool, str]:
    """Validate player name. Returns (ok, error_message_or_sanitized)."""
    sanitized = name.strip()
    if not PLAYER_NAME_RE.match(sanitized):
        return False, "Player name: letters, digits, space only; max 20 characters"
    return True, sanitized


# Play Nine deck: 108 cards
# Value | Name             | Quantity
# -5    | Hole-in-One      | 4
# 0     | Mulligan         | 8
# 1-12  | various          | 8 each
DECK_SPEC = [
    (-5, 4),   # Hole-in-One
    (0, 8),    # Mulligan
]
for v in range(1, 13):
    DECK_SPEC.append((v, 8))


@dataclass
class Card:
    value: int
    face_up: bool = False


@dataclass
class Player:
    id: str
    name: str
    hand: list[Card] = field(default_factory=list)
    revealed_count: int = 0  # How many cards they've flipped face-up (0-2 in reveal phase)


@dataclass
class TableState:
    """State for a single table (lobby/waiting room or active game)."""
    name: str
    players: list[Player] = field(default_factory=list)
    phase: str = "waiting"  # waiting | reveal | play | scoring
    round_num: int = 0
    current_player_idx: int = 0
    draw_pile: list[Card] = field(default_factory=list)
    discard_pile: list[Card] = field(default_factory=list)
    dealer_idx: int = 0
    scores: dict[str, int] = field(default_factory=dict)  # player_id -> cumulative score
    # Play phase
    drawn_card: Optional[Card] = None
    drawn_from: Optional[str] = None  # "draw" or "discard"
    must_flip_after_discard: bool = False  # True when player discarded and has 2+ face-down
    hole_ended_by: Optional[int] = None  # player idx who triggered hole end
    final_turns_remaining: list[int] = field(default_factory=list)
    round_scores: dict[str, int] = field(default_factory=dict)  # this round's scores

    DATA_DIR = Path("/play9")

    @classmethod
    def load(cls, table_name: str) -> Optional["TableState"]:
        path = cls._path(table_name)
        if not path.exists():
            return None
        data = json.loads(path.read_text())
        return cls.from_dict(data)

    def save(self) -> None:
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._path(self.name).write_text(json.dumps(self.to_dict(), indent=2))

    @classmethod
    def _path(cls, table_name: str) -> Path:
        return cls.DATA_DIR / f"{table_name}.json"

    def to_dict(self) -> dict:
        def card_to_dict(c: Card) -> dict:
            return {"value": c.value, "face_up": c.face_up}

        def player_to_dict(p: Player) -> dict:
            return {
                "id": p.id,
                "name": p.name,
                "hand": [card_to_dict(c) for c in p.hand],
                "revealed_count": p.revealed_count,
            }

        d = {
            "name": self.name,
            "players": [player_to_dict(p) for p in self.players],
            "phase": self.phase,
            "round_num": self.round_num,
            "current_player_idx": self.current_player_idx,
            "draw_pile": [{"value": c.value, "face_up": False} for c in self.draw_pile],
            "discard_pile": [card_to_dict(c) for c in self.discard_pile],
            "dealer_idx": self.dealer_idx,
            "scores": self.scores,
        }
        if self.drawn_card:
            d["drawn_card"] = card_to_dict(self.drawn_card)
            d["drawn_from"] = self.drawn_from
        if self.must_flip_after_discard:
            d["must_flip_after_discard"] = True
        if self.hole_ended_by is not None:
            d["hole_ended_by"] = self.hole_ended_by
            d["final_turns_remaining"] = self.final_turns_remaining
        if self.round_scores:
            d["round_scores"] = self.round_scores
        return d

    FACE_DOWN_MASK = -99

    def to_public_dict(self) -> dict:
        """Sanitized state for clients: no hidden card values. Face-down = -99."""
        def hand_to_public(hand: list) -> list:
            return [
                {"value": c.value if c.face_up else self.FACE_DOWN_MASK, "face_up": c.face_up}
                for c in hand
            ]

        discard = self.discard_pile
        discard_top = [c.value for c in discard[-2:]] if discard else []
        discard_top.reverse()

        d = {
            "name": self.name,
            "players": [
                {
                    "id": p.id,
                    "name": p.name,
                    "hand": hand_to_public(p.hand),
                    "revealed_count": p.revealed_count,
                }
                for p in self.players
            ],
            "phase": self.phase,
            "round_num": self.round_num,
            "current_player_idx": self.current_player_idx,
            "draw_pile_count": len(self.draw_pile),
            "discard_pile_count": len(self.discard_pile),
            "discard_pile_top": discard_top,
            "dealer_idx": self.dealer_idx,
            "scores": self.scores,
        }
        if self.drawn_card:
            d["drawn_card"] = {"value": self.drawn_card.value, "face_up": True}
            d["drawn_from"] = self.drawn_from
        if self.must_flip_after_discard:
            d["must_flip_after_discard"] = True
        if self.hole_ended_by is not None:
            d["hole_ended_by"] = self.hole_ended_by
            d["final_turns_remaining"] = self.final_turns_remaining
        if self.round_scores:
            d["round_scores"] = self.round_scores
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "TableState":
        def dict_to_card(c: dict) -> Card:
            return Card(value=c["value"], face_up=c.get("face_up", False))

        def dict_to_player(p: dict) -> Player:
            return Player(
                id=p["id"],
                name=p["name"],
                hand=[dict_to_card(c) for c in p.get("hand", [])],
                revealed_count=p.get("revealed_count", 0),
            )

        drawn = d.get("drawn_card")
        return cls(
            name=d["name"],
            players=[dict_to_player(p) for p in d.get("players", [])],
            phase=d.get("phase", "waiting"),
            round_num=d.get("round_num", 0),
            current_player_idx=d.get("current_player_idx", 0),
            draw_pile=[dict_to_card(c) for c in d.get("draw_pile", [])],
            discard_pile=[dict_to_card(c) for c in d.get("discard_pile", [])],
            dealer_idx=d.get("dealer_idx", 0),
            scores=d.get("scores", {}),
            drawn_card=dict_to_card(drawn) if drawn else None,
            drawn_from=d.get("drawn_from"),
            must_flip_after_discard=d.get("must_flip_after_discard", False),
            hole_ended_by=d.get("hole_ended_by"),
            final_turns_remaining=d.get("final_turns_remaining", []),
            round_scores=d.get("round_scores", {}),
        )


def build_deck() -> list[Card]:
    """Build and shuffle a 108-card Play Nine deck."""
    deck: list[Card] = []
    for value, count in DECK_SPEC:
        for _ in range(count):
            deck.append(Card(value=value, face_up=False))
    random.shuffle(deck)
    return deck


def start_game(table: TableState) -> Optional[str]:
    """Start the first round. Returns error message or None on success."""
    if table.phase != "waiting":
        return "Game already started"
    if len(table.players) < 2:
        return "Need at least 2 players"
    return _deal_new_round(table, round_num=1)


def restart_game(table: TableState) -> Optional[str]:
    """Restart the game: reset scores, deal fresh round 1 for all players."""
    if len(table.players) < 2:
        return "Need at least 2 players"
    table.scores = {}
    table.round_scores = {}
    return _deal_new_round(table, round_num=1)


def _deal_new_round(table: TableState, round_num: int = 1) -> Optional[str]:
    """Deal a new round. Keeps players, resets hands and piles."""
    deck = build_deck()
    for p in table.players:
        p.hand = [deck.pop() for _ in range(8)]
        p.revealed_count = 0
    table.draw_pile = deck
    top = table.draw_pile.pop()
    top.face_up = True
    table.discard_pile = [top]
    table.drawn_card = None
    table.drawn_from = None
    table.must_flip_after_discard = False
    table.hole_ended_by = None
    table.final_turns_remaining = []
    table.dealer_idx = len(table.players) - 1
    table.current_player_idx = 0
    table.round_num = round_num
    table.phase = "reveal"
    return None


def reveal_card(table: TableState, player_id: str, card_index: int) -> Optional[str]:
    """Flip a card face-up during reveal phase. Returns error or None."""
    if table.phase != "reveal":
        return "Not in reveal phase"
    player = next((p for p in table.players if p.id == player_id), None)
    if not player:
        return "Not a player"
    if player.revealed_count >= 2:
        return "Already revealed 2 cards"
    if not 0 <= card_index < len(player.hand):
        return "Invalid card"
    card = player.hand[card_index]
    if card.face_up:
        return "Card already face-up"
    card.face_up = True
    player.revealed_count += 1
    # Check if all players have revealed 2 → transition to play
    if all(p.revealed_count >= 2 for p in table.players):
        table.phase = "play"
    return None


def _advance_turn(table: TableState) -> None:
    """Move to next player or scoring phase."""
    n = len(table.players)
    if table.hole_ended_by is not None:
        just_finished = table.current_player_idx
        table.final_turns_remaining = [i for i in table.final_turns_remaining if i != just_finished]
        # Flip remaining face-down cards for tallying
        for c in table.players[just_finished].hand:
            c.face_up = True
        if not table.final_turns_remaining:
            _finish_hole(table)
            return
        table.current_player_idx = table.final_turns_remaining[0]
    else:
        table.current_player_idx = (table.current_player_idx + 1) % n


def _check_hole_end(table: TableState, player_idx: int) -> bool:
    """True if this player just went all face-up."""
    p = table.players[player_idx]
    return all(c.face_up for c in p.hand)


def _finish_hole(table: TableState) -> None:
    """Flip remaining face-downs, score, transition to scoring phase."""
    for p in table.players:
        for c in p.hand:
            c.face_up = True
    table.round_scores = {p.id: _score_hand(p.hand) for p in table.players}
    for pid, s in table.round_scores.items():
        table.scores[pid] = table.scores.get(pid, 0) + s
    table.phase = "scoring"
    table.drawn_card = None
    table.drawn_from = None
    table.must_flip_after_discard = False
    table.hole_ended_by = None
    table.final_turns_remaining = []


def advance_from_scoring(table: TableState) -> Optional[str]:
    """After scoring phase: start next round or end game."""
    if table.phase != "scoring":
        return "Not in scoring phase"
    if table.round_num >= 9:
        table.phase = "waiting"
        table.round_num = 0
        table.round_scores = {}
        table.scores = {}
        for p in table.players:
            p.hand = []
            p.revealed_count = 0
        table.draw_pile = []
        table.discard_pile = []
        return None
    table.round_num += 1
    deck = build_deck()
    for p in table.players:
        p.hand = [deck.pop() for _ in range(8)]
        p.revealed_count = 0
    table.draw_pile = deck
    top = table.draw_pile.pop()
    top.face_up = True
    table.discard_pile = [top]
    table.dealer_idx = (table.dealer_idx + 1) % len(table.players)
    table.current_player_idx = (table.dealer_idx + 1) % len(table.players)
    table.round_scores = {}
    table.phase = "reveal"
    return None


def _score_hand(hand: list[Card]) -> int:
    """Score a hand (4 cols x 2 rows). Same in column = 0 (or -10 if both -5). Different = sum."""
    if len(hand) != 8:
        return sum(c.value for c in hand if c.face_up)
    cols = [[hand[i], hand[i + 4]] for i in range(4)]

    total = 0
    for col in cols:
        v0, v1 = col[0].value, col[1].value
        if v0 == v1:
            if v0 == -5:
                total += -10
            else:
                total += 0
        else:
            total += v0 + v1

    # Bonus: multiple columns with the SAME pair value (e.g. two columns of 1/1)
    pair_values = [col[0].value for col in cols if col[0].value == col[1].value]
    counts = Counter(pair_values)
    max_same = max(counts.values()) if counts else 0
    if max_same >= 3:
        total += -15
    elif max_same >= 2:
        total += -10

    return total


def draw_from_draw(table: TableState, player_id: str) -> Optional[str]:
    """Draw top card from draw pile. Must be current player, no card already drawn."""
    if table.phase != "play":
        return "Not in play phase"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None:
        return "Not a player"
    if idx != table.current_player_idx:
        return "Not your turn"
    if table.drawn_card is not None:
        return "Already drew"
    if not table.draw_pile:
        return "Draw pile empty"
    card = table.draw_pile.pop()
    card.face_up = True
    table.drawn_card = card
    table.drawn_from = "draw"
    return None


def draw_from_discard(table: TableState, player_id: str) -> Optional[str]:
    """Draw top card from discard pile."""
    if table.phase != "play":
        return "Not in play phase"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None:
        return "Not a player"
    if idx != table.current_player_idx:
        return "Not your turn"
    if table.drawn_card is not None:
        return "Already drew"
    if not table.discard_pile:
        return "Discard pile empty"
    card = table.discard_pile.pop()
    table.drawn_card = card
    table.drawn_from = "discard"
    return None


def play_replace(table: TableState, player_id: str, card_index: int) -> Optional[str]:
    """Replace hand card with drawn card; old card goes to discard."""
    if table.phase != "play" or table.drawn_card is None:
        return "No card drawn"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None or idx != table.current_player_idx:
        return "Not your turn"
    if not 0 <= card_index < 8:
        return "Invalid card index"
    player = table.players[idx]
    old = player.hand[card_index]
    player.hand[card_index] = table.drawn_card
    old.face_up = True
    table.discard_pile.append(old)
    table.drawn_card = None
    table.drawn_from = None
    if _check_hole_end(table, idx):
        n = len(table.players)
        table.hole_ended_by = idx
        # Continue in same direction; everyone after the finisher gets one final turn (until we would reach finisher again)
        table.final_turns_remaining = [
            (idx + i) % n
            for i in range(1, n)
            if not _check_hole_end(table, (idx + i) % n)
        ]
        if table.final_turns_remaining:
            table.current_player_idx = table.final_turns_remaining[0]
        else:
            _finish_hole(table)
        return None
    _advance_turn(table)
    return None


def play_discard_flip(table: TableState, player_id: str, card_index: int) -> Optional[str]:
    """Discard drawn card and flip a face-down card."""
    if table.phase != "play" or table.drawn_card is None:
        return "No card drawn"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None or idx != table.current_player_idx:
        return "Not your turn"
    if not 0 <= card_index < 8:
        return "Invalid card index"
    player = table.players[idx]
    card = player.hand[card_index]
    if card.face_up:
        return "Card already face-up"
    table.discard_pile.append(table.drawn_card)
    table.drawn_card = None
    table.drawn_from = None
    card.face_up = True
    if _check_hole_end(table, idx):
        n = len(table.players)
        table.hole_ended_by = idx
        # Continue in same direction; everyone after the finisher gets one final turn (until we would reach finisher again)
        table.final_turns_remaining = [
            (idx + i) % n
            for i in range(1, n)
            if not _check_hole_end(table, (idx + i) % n)
        ]
        if table.final_turns_remaining:
            table.current_player_idx = table.final_turns_remaining[0]
        else:
            _finish_hole(table)
        return None
    _advance_turn(table)
    return None


def play_flip_after_discard(table: TableState, player_id: str, card_index: int) -> Optional[str]:
    """Flip a face-down card after discarding when 2+ face-down remain."""
    if table.phase != "play":
        return "Not in play phase"
    if not table.must_flip_after_discard:
        return "No flip required"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None or idx != table.current_player_idx:
        return "Not your turn"
    if not 0 <= card_index < 8:
        return "Invalid card index"
    player = table.players[idx]
    card = player.hand[card_index]
    if card.face_up:
        return "Card already face-up"
    card.face_up = True
    table.must_flip_after_discard = False
    if _check_hole_end(table, idx):
        n = len(table.players)
        table.hole_ended_by = idx
        # Continue in same direction; everyone after the finisher gets one final turn (until we would reach finisher again)
        table.final_turns_remaining = [
            (idx + i) % n
            for i in range(1, n)
            if not _check_hole_end(table, (idx + i) % n)
        ]
        if table.final_turns_remaining:
            table.current_player_idx = table.final_turns_remaining[0]
        else:
            _finish_hole(table)
        return None
    _advance_turn(table)
    return None


def play_put_back(table: TableState, player_id: str) -> Optional[str]:
    """Put drawn card back on discard pile (only when drawn from discard). Does not end turn."""
    if table.phase != "play" or table.drawn_card is None:
        return "No card drawn"
    if table.drawn_from != "discard":
        return "Can only put back when drawn from discard"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None or idx != table.current_player_idx:
        return "Not your turn"
    table.discard_pile.append(table.drawn_card)
    table.drawn_card = None
    table.drawn_from = None
    return None


def play_discard_only(table: TableState, player_id: str) -> Optional[str]:
    """Discard drawn card without replacing (only when drawn from draw pile)."""
    if table.phase != "play" or table.drawn_card is None:
        return "No card drawn"
    if table.drawn_from != "draw":
        return "Cannot discard back to discard pile when drawn from discard"
    idx = next((i for i, p in enumerate(table.players) if p.id == player_id), None)
    if idx is None or idx != table.current_player_idx:
        return "Not your turn"
    player = table.players[idx]
    face_down = sum(1 for c in player.hand if not c.face_up)
    table.discard_pile.append(table.drawn_card)
    table.drawn_card = None
    table.drawn_from = None
    if face_down >= 2:
        table.must_flip_after_discard = True
    else:
        _advance_turn(table)
    return None


def create_player(name: str) -> Player:
    return Player(id=str(uuid.uuid4()), name=name)


def add_player_to_table(table_name: str, player_name: str) -> tuple[Optional[Player], Optional[str], Optional[str]]:
    """Add a player to a table. Creates table if needed. Returns (player, table_name, error)."""
    ok, name = validate_player_name(player_name)
    if not ok:
        return None, None, name
    ok, tn = validate_table_name(table_name)
    if not ok:
        return None, None, tn
    table = TableState.load(tn) or TableState(name=tn)
    player = create_player(name)
    table.players.append(player)
    table.save()
    return player, tn, None
