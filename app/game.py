"""Game state, deck, and validation logic."""

from __future__ import annotations

import json
import random
import re
import uuid
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

        return {
            "name": self.name,
            "players": [player_to_dict(p) for p in self.players],
            "phase": self.phase,
            "round_num": self.round_num,
            "current_player_idx": self.current_player_idx,
            "draw_pile": [card_to_dict(c) for c in self.draw_pile],
            "discard_pile": [card_to_dict(c) for c in self.discard_pile],
            "dealer_idx": self.dealer_idx,
            "scores": self.scores,
        }

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
    deck = build_deck()
    for p in table.players:
        p.hand = [deck.pop() for _ in range(8)]
        p.revealed_count = 0
    table.draw_pile = deck
    top = table.draw_pile.pop()
    top.face_up = True
    table.discard_pile = [top]
    table.dealer_idx = len(table.players) - 1
    table.current_player_idx = 0
    table.round_num = 1
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
