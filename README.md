# Play Nine

Let’s create a web-based version of the Play Nine multi-player card game. The game will be implemented as a client/server application using python on the server side and HTML/JS/CSS on the client side. Clients will use HTTP to download any static content. Web sockets will be used by the server to convey the game state to the clients and by the clients to convey player moves to the server.
Server should maintain the game state and preserve it in JSON files. The server should expose all content on /play9 endpoint and port  9999.

This digital version of the game should be designed to be played using 
* player’s mobile phones with touch screens for Player View that shows just the draw pile, discard pile and player’s own card arrangement and
* using a separate read-only Table View that displays the entire game state, which includes the draw pile and discard pile in the center surrounded by all player’s card  arrangements

To facilitate remote play, multiple Table Views can be connected at a time. 

Players will use the touch screens (or pointing devices) to interact with their card arrangements, draw pile or discard pile using drag and drop gestures. As players drag their cards from/to their card arrangement, draw pile, or discard pile their moves should be broadcast to the shared Table View(s). 

## User Experience
The user interface should strive to be minimalistic with a subtle golf inspired theme. It should support mobile devices so clicks should also mean taps. Any confirmation dialogs should avoid using the browser native ones and instead be custom ones, themed appropriately.


## Game UX Mechanics

### Lobby Room View
Players will enter the game via a Lobby View which presents the users with a simple form asking for Table Name and Player Name on submitting the form, the players will enter Waiting Room view.
* Table name should be lowercase letters, digits, -, and _ only; 20 characters max; client should force the characters to lowercase
* Player name should be letters, digits and space only; 20 characters maz
* Both the client and server should enforce this independently

Serve the lobby view under the main `/play9` path.

### Waiting Room View
The Waiting Room view will show a dynamic view listing all other players in the Waiting Room (updated as players leave/enter to room) and a Start Game button, which should be enabled as soon as at least two players are in the room. 
The waiting room should have a Leave Table button (lucide icon for logging out) in the upper right corner. Pressing this icon should return the user to the Lobby view.
Pressing the Start Game button should initiate the first of 9 rounds in the game for all the players currently in the waiting room.

On entering the waiting room, the player should be assigned a unique (albeit temporary ID - UUID). The server should use this ID to track the player and their data and to present their view.

The players will play in the order in which they entered the waiting room. The last person in the room starts as the dealer. Each subsequent round, the role of the dealer is passed to the next player.

The rounds are started by dealing 8 cards to each player, arranged in four columns of two cards - all face-down. 

The first phase of the round starts by each player selecting two cards they wish to reveal by tapping/clicking on them. This will flip the cards face-up. Once every player has done this, the round can start.
The player next to the dealer is the first person to take their turn.

When it is player’s turn, they start by “taking a card”, which is dragging a card off either the discard pile or from the draw pile using their Player View. Taking a card from the draw pile should reveal the card to everyone as soon as the drag gesture is initiated. The player can drop the card on anywhere in their view. 
* If they don’t want the card, they should drop it onto the discard pile.
* If they want it, they should drag it onto the card that they wish to replace with it.
* Accidentally dropping a card that was picked up anywhere on the background should leave the card there so that it can be dragged onto either the discard pile or a card in player’s hand.
* If player replaced a card in their hand, it should be placed in the discard pile.

Visually, the cards in the discard pile should be slightly rotated (by random amount between 10-60 degrees to give the pile a more organic look.
As the user drags the cards, the movement of the drag should be broadcast to all the Table Views in a dynamic fashion and as smoothly as possible.
After the drag is completed to a valid destination, the current player’s turn is automatically completed and the next person is given their turn.

### Table View
The table view should show the discard pile and the draw pile next to each other, in the center of the view.  Surrounding the pile should be representations of each player’s card layouts (4 columns of 2 cards). These representations should be arranged in the clockwise order around the draw and discard piles. The layout should be optimized for landscape orientation as this view is expected to be shared on 4K television(s). This view should update in real-time.

### Player View
The player view should show the discard pile and the draw pile next to each other near the top part of the screen, while the player’s own card layout should occupy the bottom of the screen. This layout should optimized for portrait orientation as it’s expected to be used on mobile phones.

The Waiting Room view, Table View and Player Views are just logical distinction of  same resource `/play9/table/<table-name>`. For player views, it is `/play9/table/<table-name>?id=<player-id>`


### Score Card View
At the end of each round a flyover should be displayed in all the views (Table and Player Views) listing players in the order of their score (lowest to highest). The list should include the players rank, their name, their score this round and the cumulative score since the first round. The cumulative score should be emphasized. The score window should stay up for 15 seconds. The count-down timer should be displayed at the bottom of the score screen with “Next round starts in …” above it. After the ninth round, the count down should be 60 seconds with “Next game starts in…” above it.

## Game Rules
**Play Nine is a golf-themed card game for 2-6 players (ages 8+), using a 108-card deck with values from -5 (Hole-in-One) to 12 (Out-of-Bounds). The objective is to complete 9 "holes" (rounds) with the lowest total score.

**Setup:**  
Shuffle and deal 8 cards face-down to each player, arranged in a 2x4 grid. Flip any 2 cards face-up. Place remaining cards as the draw pile; flip top card to start discard pile. Lowest drawn card determines first dealer (rotate left each hole).

**Gameplay:**  
Play clockwise. On your turn:  
1. Draw 1 card from draw pile OR discard pile (must use it if from discard).  
2. Either: Replace any 1 of your 8 cards (face-up or down) and discard the old one, OR discard the drawn card and flip 1 face-down card face-up.  
(With 1 face-down left, you may draw and discard without flipping/replacing to skip.)

**End of Hole:**  
When a player flips/replaces their last face-down card (all 8 face-up), the hole ends. Others get 1 final turn, then flip any remaining face-downs. Score and record.

**Scoring:**  
Sum visible card values (-5 to 12). Reduce via "Shaving Strokes":  
- Vertical pairs (same number in column): 0 points.  
- 4 matching in 2 columns: -10 bonus.  
- 6 in 3: -15. 8 in 4: -20.  
Hole-in-Ones: -5 each; multiples add up with bonuses. Lowest hole score recorded; after 9 holes, lowest total wins (tiebreaker: sudden-death holes).**


## Card Deck
**Play Nine Deck: 108 cards total (two 54-card packs for standard 2-6 player game).

| Value | Name | Quantity |
|-------|------|----------|
| -5 | Hole-in-One | 4 |
| 0 | Mulligan | 8 |
| 1 | Birdie | 8 |
| 2 | Birdie | 8 |
| 3 | Par | 8 |
| 4 | Par | 8 |
| 5 | Bogey | 8 |
| 6 | Bogey | 8 |
| 7 | Double Bogey | 8 |
| 8 | Double Bogey | 8 |
| 9 | Triple Bogey | 8 |
| 10 | Quadruple Bogey | 8 |
| 11 | Quintuple Bogey | 8 |
| 12 | Out-of-Bounds | 8 |

**Notes:**  
- Each 54-card pack: 4× of 0-12 (52 cards) + 2× Hole-in-One.  
- For 8 players: Use 3 packs (162 cards total: 12× of 0-12 + 6× Hole-in-One).
