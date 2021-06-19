mod defs;

use wasm_bindgen::prelude::*;
use std::{cmp::{max, min}, intrinsics::transmute, mem::swap, usize, vec};

use rand::Rng;

use crate::defs::{
    set_panic_hook,
    Value,
    Piece,
    CastleStatus,
    BoardDelta,
    EvalMove,
    EvaluationData,
    DebugMoveOutput,
    MoveInfo,
    SavedEvalType,
    PAWN_SQUARE_TABLE,
    ROOK_SQUARE_TABLE,
    KNIGHT_SQUARE_TABLE,
    BISHOP_SQUARE_TABLE,
    QUEEN_SQUARE_TABLE,
    KING_MIDDLE_GAME_SQUARE_TABLE
};

// #[global_allocator]
// static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern {
    fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    // workaround to perf.now() in webworkers
    #[wasm_bindgen(js_namespace = ["self", "performance"])]
    fn now(s: &str) -> u32;

    #[wasm_bindgen(js_namespace = self)]
    fn post_eval_message(s: &str, eval: i32);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, bandersnatch-wasm!");
}

// -----------------------------------------------------------------------------------------

#[wasm_bindgen]
pub struct Engine {
    fen_to_piece_map: hashbrown::HashMap<String, Piece>,
    zobrist_hash_table: Vec<Vec<u64>>,

    board: [Piece; 64],
    board_hash: u64,
    white_turn: bool,
    castle_status: CastleStatus,
    en_passant_square: i32,
    move_count: i32,
    move_rep_count: i32,

    board_deltas: Vec<BoardDelta>,
    piece_locations: Vec<Vec<usize>>,
    pinned_pieces: Vec<usize>,
    repetition_history: Vec<u64>,
    saved_evaluations: hashbrown::HashMap<u64, EvaluationData>,

    castled_this_turn: bool,
    piece_captured_this_turn: bool,
    in_check: bool,
    all_valid_moves: Vec<EvalMove>,
    best_move: EvalMove,
    best_move_this_iteration: EvalMove,
    search_start_time: u32,
    search_max_time: u32,
    time_taken_last_turn: u32,
    depth_searched_last_turn: i32,
    moves_found_this_turn: Vec<DebugMoveOutput>,
    moves_found_this_iteration: Vec<DebugMoveOutput>,
}

#[wasm_bindgen]
impl Engine {
    pub fn new() -> Engine {
        // initialize debug hook
        set_panic_hook();

        // init hash table
        let mut zobrist_hashes: Vec<Vec<u64>> = vec![];
        let hash_max: u64 = 2;
        let hash_max = hash_max.pow(64) - 1;

        // piece locations (0-63)
        for i in 0..64 {
            zobrist_hashes.push(vec![]);
            for _j in 0..12 {
                zobrist_hashes[i].push(rand::thread_rng().gen_range(0..hash_max));
            }
        }

        // castle values (64)
        let mut castle_values: Vec<u64> = vec![];
        for _i in 0..4 {
            castle_values.push(rand::thread_rng().gen_range(0..hash_max));
        }
        zobrist_hashes.push(castle_values);

        // turn (65)
        zobrist_hashes.push(vec![rand::thread_rng().gen_range(0..hash_max)]);

        // en passant (66)
        let mut en_passant_squares: Vec<u64> = vec![];
        for _i in 0..64 {
            en_passant_squares.push(rand::thread_rng().gen_range(0..hash_max));
        }
        zobrist_hashes.push(en_passant_squares);     

        Engine {
            fen_to_piece_map: [
                (String::from("K"), Piece::King_W),
                (String::from("Q"), Piece::Queen_W),
                (String::from("R"), Piece::Rook_W),
                (String::from("B"), Piece::Bishop_W),
                (String::from("N"), Piece::Knight_W),
                (String::from("P"), Piece::Pawn_W),
                (String::from("k"), Piece::King_B),
                (String::from("q"), Piece::Queen_B),
                (String::from("r"), Piece::Rook_B),
                (String::from("b"), Piece::Bishop_B),
                (String::from("n"), Piece::Knight_B),
                (String::from("p"), Piece::Pawn_B)
            ].iter().cloned().collect(),
            zobrist_hash_table: zobrist_hashes,

            board: [Piece::Empty; 64],
            board_hash: 0,
            white_turn: true,
            castle_status: CastleStatus::UNSET,
            en_passant_square: 0,
            move_count: 0,
            move_rep_count: 0,

            board_deltas: vec![],
            piece_locations: vec![
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![],
                vec![]
            ],
            pinned_pieces: vec![],
            repetition_history: vec![],
            saved_evaluations: hashbrown::HashMap::new(),

            castled_this_turn: false,
            piece_captured_this_turn: false,
            in_check: false,
            all_valid_moves: vec![],
            best_move: Default::default(),
            best_move_this_iteration: Default::default(),
            search_start_time: 0,
            search_max_time: 3000,
            time_taken_last_turn: 0,
            depth_searched_last_turn: 0,
            moves_found_this_turn: vec![],
            moves_found_this_iteration: vec![],
        }
    }

    fn remove_piece(&mut self, piece: Piece, index: usize) {
        let piece_as_index = piece as usize;
        match self.piece_locations[piece_as_index]
            .iter()
            .position(|&r| r == index) {
                Some(i) => {
                    self.piece_locations[piece_as_index][i] = *self.piece_locations[piece_as_index].last().unwrap();
                    self.piece_locations[piece_as_index].pop();
                },
                None => {}
            }
    }

    fn move_piece(&mut self, piece: Piece, index: usize, new_location: usize) {
        let piece_as_index = piece as usize;
        match self.piece_locations[piece_as_index]
            .iter()
            .position(|&r| r == index) {
                Some(i) => {
                    self.piece_locations[piece_as_index][i] = new_location;
                },
                None => {}
            }
    }

    pub fn find_piece_in_file(&self, piece: usize, file: &str) -> i32 {
        for location in self.piece_locations[piece].iter() {
            let found_file = Engine::index_to_notation(*location).chars().nth(0).unwrap().to_string();
            if found_file == file {
                return *location as i32;
            }
        }

        -1
    }

    pub fn index_to_notation(index: usize) -> String {
        let y = (index as f32 * 0.125) as u32;
        let x = index as u32 % 8;
        match std::char::from_u32(x + 97) {
            Some(c) => c.to_string() + &(8 - y).to_string(),
            None => String::from("")
        }
    }

    pub fn notation_to_index(rank: char, file: char) -> usize {
        let mut y: usize = match rank.to_string().parse() {
            Ok(n) => n,
            Err(_e) => 0,
        };
        y = 8 - y;

        // notation must be in ascii but that should always be the case
        let x: usize = (file as usize) - 97;

        (y * 8) + x
    }

    pub fn hash_board(&mut self) -> u64 {
        let mut hash: u64 = 0;

        // board values
        for i in 0..self.board.len() {
            if self.board[i] != Piece::Empty {
                let j = self.board[i] as usize - 1;
                hash ^= self.zobrist_hash_table[i][j];
            }
        }

        // castle values
        if !(self.castle_status & CastleStatus::WHITE_KING).is_empty() {
            hash ^= self.zobrist_hash_table[64][0];
        }
        if !(self.castle_status & CastleStatus::WHITE_QUEEN).is_empty() {
            hash ^= self.zobrist_hash_table[64][1];
        }
        if !(self.castle_status & CastleStatus::BLACK_KING).is_empty() {
            hash ^= self.zobrist_hash_table[64][2];
        }
        if !(self.castle_status & CastleStatus::BLACK_QUEEN).is_empty() {
            hash ^= self.zobrist_hash_table[64][3];
        }

        // turn
        if self.white_turn {
            hash ^= self.zobrist_hash_table[65][0];
        }

        // en passant
        if self.en_passant_square != -1 {
            hash ^= self.zobrist_hash_table[66][self.en_passant_square as usize];
        }

        hash
    }

    // todo: add error handling
    pub fn parse_fen(&mut self, fen: &str) {
        let fields: Vec<&str> = fen.split(" ").collect();
        if fields.len() != 6 {
            return; // invalid fen string
        }

        // parse pieces
        let mut board_index: usize = 0;
        let ranks = fields[0].split("/");
        for r in ranks {
            let terms = r.split("");
            for t in terms {
                if t == "" {
                    continue;
                }
                let num: usize = match t.parse() {
                    Ok(n) => {
                        n
                    },
                    Err(_e) => {
                        let piece = self.fen_to_piece_map
                            .entry(String::from(t))
                            .or_insert(Piece::Empty);
                        self.board[board_index] = *piece;
                        self.piece_locations[*piece as usize].push(board_index);
                        1
                    }
                };
                board_index += num;
            }
        }

        // parse turn
        self.white_turn = fields[1] == "w";

        // parse castle flags
        self.castle_status = CastleStatus::UNSET;
        if fields[2].contains('K') {
            self.castle_status |= CastleStatus::WHITE_KING;
        }
        if fields[2].contains('Q') {
            self.castle_status |= CastleStatus::WHITE_QUEEN;
        }
        if fields[2].contains('k') {
            self.castle_status |= CastleStatus::BLACK_KING;
        }
        if fields[2].contains('q') {
            self.castle_status |= CastleStatus::BLACK_QUEEN;
        }

        // parse en passant square
        if fields[3] != "-" {
            self.en_passant_square = Engine::notation_to_index(
                fields[3].chars().nth(1).unwrap(),
                fields[3].chars().nth(0).unwrap()
            ) as i32;
        }

        // parse move counts
        self.move_rep_count = fields[4].parse().unwrap();
        self.move_count = fields[5].parse().unwrap();
        self.move_count = self.move_count * 2 - 2;

        self.board_hash = self.hash_board();
        self.repetition_history.clear();
        self.repetition_history.push(self.board_hash);
        self.all_valid_moves = self.get_all_valid_moves(false, &mut vec![]);
    }

    pub fn use_historical_board(&mut self) {
        self.board_deltas.clear();
        self.saved_evaluations.clear();
        self.board_hash = self.hash_board();
        self.best_move = Default::default();
        self.all_valid_moves = self.get_all_valid_moves(
            false, 
            &mut vec![]
        );
    }

    pub fn finish_turn(&mut self) {
        self.white_turn = !self.white_turn;
        self.board_hash = self.hash_board();
        self.board_deltas.clear();
        self.all_valid_moves = self.get_all_valid_moves(false, &mut vec![]);
        self.in_check = self.is_in_check(self.white_turn);
        self.saved_evaluations.clear();

        self.move_count += 1;
        self.move_rep_count += 1;
    }

    pub fn force_make_move(&mut self, from_index: usize, move_info: &MoveInfo, finish_turn: bool) {
        let to_index = move_info.index;
        let moving_piece = self.board[from_index];
        let captured_piece = self.board[to_index];

        self.board_deltas.push(BoardDelta {
            index: to_index as i32,
            piece: captured_piece,
            target: -1
        });
        self.board_deltas.push(BoardDelta {
            index: from_index as i32,
            piece: moving_piece,
            target: to_index as i32
        });
        self.board[to_index] = moving_piece;
        self.board[from_index] = Piece::Empty;

        // promotion check
        let mut promoted = false;
        let y: usize = (to_index as f32 * 0.125) as usize; // 0.125 = 1/8
        if moving_piece == Piece::Pawn_W && y == 0 {
            self.board[to_index] = move_info.data;
            self.remove_piece(Piece::Pawn_W, from_index);
            self.piece_locations[move_info.data as usize].push(to_index);
            self.board_deltas.push(BoardDelta {
                index: -1,
                piece: move_info.data,
                target: to_index as i32
            });
            promoted = true;
        }
        else if moving_piece == Piece::Pawn_B && y == 7 {
            self.board[to_index] = move_info.data;
            self.remove_piece(Piece::Pawn_B, from_index);
            self.piece_locations[move_info.data as usize].push(to_index);
            self.board_deltas.push(BoardDelta {
                index: -1,
                piece: move_info.data,
                target: to_index as i32
            });
            promoted = true;
        }

        // en passant check
        if to_index as i32 == self.en_passant_square { // capturing en passant, so remove the pawn and add a delta
            if moving_piece == Piece::Pawn_W {
                self.board_deltas.push(BoardDelta {
                    index: to_index as i32 + 8,
                    piece: Piece::Pawn_B,
                    target: -1
                });
                self.board[to_index + 8] = Piece::Empty;
            } else if moving_piece == Piece::Pawn_B {
                self.board_deltas.push(BoardDelta {
                    index: to_index as i32 - 8,
                    piece: Piece::Pawn_W,
                    target: -1
                });
                self.board[to_index - 8] = Piece::Empty;
            }
        }

        if moving_piece == Piece::Pawn_W && from_index - to_index == 16 { // moving two spaces up
            self.en_passant_square = from_index as i32 - 8;
        } else if moving_piece == Piece::Pawn_B && to_index - from_index == 16 { // moving two spaces down
            self.en_passant_square = from_index as i32 + 8;
        } else {
            self.en_passant_square = -1;
        }

        // update moved piece position unless promoted since that is already handled
        if !promoted {
            self.move_piece(moving_piece, from_index, to_index);
        }

        // remove captured piece
        if captured_piece != Piece::Empty {
            self.remove_piece(captured_piece, to_index);
        }

        if finish_turn {
            self.finish_turn();

            // update board repetition history
            if moving_piece == Piece::Pawn_W || moving_piece == Piece::Pawn_B || captured_piece != Piece::Empty { // repetitions not possible with these moves
                self.repetition_history.clear();
                self.move_rep_count = 0;
            } else {
                self.repetition_history.push(self.board_hash);
            }
        }
    }

    // cannot be pub since wasm_bindgen doesnt support struct slice refs
    fn unmake_move(&mut self, deltas: &[BoardDelta]) {
        self.white_turn = !self.white_turn;

        for elem in deltas.iter() {
            let target_as_usize = elem.target as usize;
            let piece_as_usize = elem.piece as usize;
            let index_as_usize = elem.index as usize;

            if elem.piece != Piece::Empty { // ignore any empty piece entries
                if elem.index == -1 { // if the original index is -1, it means the piece was created from promotion, so remove the piece
                    self.remove_piece(elem.piece, target_as_usize)
                } else if self.board[index_as_usize] != Piece::Empty { // was captured so add the piece back to register
                    self.piece_locations[piece_as_usize].push(index_as_usize);
                } else if elem.target != -1 { // otherwise just move it back
                    match self.piece_locations[piece_as_usize]
                        .iter()
                        .position(|&r| r == target_as_usize) {
                            Some(i) => {
                                self.piece_locations[piece_as_usize][i] = index_as_usize;
                            },
                            None => {
                                self.piece_locations[piece_as_usize].push(index_as_usize);
                            }
                        };
                }
            }

            if elem.index != -1 {
                self.board[index_as_usize] = elem.piece;
            }
        }
    }

    pub fn update_castle_status(&mut self, from_index: usize, to_index: usize) -> bool {
        let moving_piece = self.board[from_index];
        let mut castled = false;

        if moving_piece == Piece::King_W {
            if !(self.castle_status & CastleStatus::WHITE_KING).is_empty() && to_index == 62 {
                self.board_deltas.push(BoardDelta {
                    index: 63,
                    piece: self.board[63],
                    target: 61
                });
                self.board_deltas.push(BoardDelta {
                    index: 61,
                    piece: self.board[61],
                    target: -1
                });
                self.move_piece(Piece::Rook_W, 63, 61);
                self.board[63] = Piece::Empty;
                self.board[61] = Piece::Rook_W;
                castled = true;
            } else if !(self.castle_status & CastleStatus::WHITE_QUEEN).is_empty() && to_index == 58 {
                self.board_deltas.push(BoardDelta {
                    index: 56,
                    piece: self.board[56],
                    target: 59
                });
                self.board_deltas.push(BoardDelta {
                    index: 59,
                    piece: self.board[59],
                    target: -1
                });
                self.move_piece(Piece::Rook_W, 56, 59);
                self.board[56] = Piece::Empty;
                self.board[59] = Piece::Rook_W;
                castled = true;
            }

            self.castle_status &= !CastleStatus::WHITE_KING;
            self.castle_status &= !CastleStatus::WHITE_QUEEN;
        } else if moving_piece == Piece::King_B {
            if !(self.castle_status & CastleStatus::BLACK_KING).is_empty() && to_index == 6 {
                self.board_deltas.push(BoardDelta {
                    index: 7,
                    piece: self.board[7],
                    target: 5
                });
                self.board_deltas.push(BoardDelta {
                    index: 5,
                    piece: self.board[5],
                    target: -1
                });
                self.move_piece(Piece::Rook_B, 7, 5);
                self.board[7] = Piece::Empty;
                self.board[5] = Piece::Rook_B;
                castled = true;
            } else if !(self.castle_status & CastleStatus::BLACK_QUEEN).is_empty() && to_index == 2 {
                self.board_deltas.push(BoardDelta {
                    index: 0,
                    piece: self.board[0],
                    target: 3
                });
                self.board_deltas.push(BoardDelta {
                    index: 3,
                    piece: self.board[3],
                    target: -1
                });
                self.move_piece(Piece::Rook_B, 0, 3);
                self.board[0] = Piece::Empty;
                self.board[3] = Piece::Rook_B;
                castled = true;
            }

            self.castle_status &= !CastleStatus::BLACK_KING;
            self.castle_status &= !CastleStatus::BLACK_QUEEN;
        } else if moving_piece == Piece::Rook_W && from_index == 56 {
            self.castle_status &= !CastleStatus::WHITE_QUEEN;
        } else if moving_piece == Piece::Rook_W && from_index == 63 {
            self.castle_status &= !CastleStatus::WHITE_KING;
        } else if moving_piece == Piece::Rook_B && from_index == 0 {
            self.castle_status &= !CastleStatus::BLACK_QUEEN;
        } else if moving_piece == Piece::Rook_B && from_index == 7 {
            self.castle_status &= !CastleStatus::BLACK_KING;
        }

        castled
    }

    // cannot be pub since wasm_bindgen doesnt support struct slice refs
    fn update_hash(&self, deltas: &[BoardDelta], current_hash: u64, old_en_passant: i32, old_castle_status: CastleStatus) -> u64 {
        let mut new_hash = current_hash;

        // positions
        for elem in deltas.iter() {
            if elem.index != -1 { // -1 entries are usually for tracking, so don't worry about them when updating the hash
                let position = elem.index as usize;
                let piece = elem.piece as i32 - 1;
                let new_piece = self.board[position] as i32 - 1;
                if piece >= 0 {
                    new_hash ^= self.zobrist_hash_table[position][piece as usize];
                }
                if new_piece >= 0 {
                    new_hash ^= self.zobrist_hash_table[position][new_piece as usize];
                }
            }
        }

        // castling (flip)
        if !(old_castle_status & CastleStatus::WHITE_KING).is_empty() != !(self.castle_status & CastleStatus::WHITE_KING).is_empty() {
            new_hash ^= self.zobrist_hash_table[64][0];
        }
        if !(old_castle_status & CastleStatus::WHITE_QUEEN).is_empty() != !(self.castle_status & CastleStatus::WHITE_QUEEN).is_empty() {
            new_hash ^= self.zobrist_hash_table[64][1];
        }
        if !(old_castle_status & CastleStatus::BLACK_KING).is_empty() != !(self.castle_status & CastleStatus::BLACK_KING).is_empty() {
            new_hash ^= self.zobrist_hash_table[64][2];
        }
        if !(old_castle_status & CastleStatus::BLACK_QUEEN).is_empty() != !(self.castle_status & CastleStatus::BLACK_QUEEN).is_empty() {
            new_hash ^= self.zobrist_hash_table[64][3];
        }

        // turn (flip)
        new_hash ^= self.zobrist_hash_table[65][0];

        // en passant
        if old_en_passant != self.en_passant_square {
            if old_en_passant != -1 {
                new_hash ^= self.zobrist_hash_table[66][old_en_passant as usize];
            }
            if self.en_passant_square != -1 {
                new_hash ^= self.zobrist_hash_table[66][self.en_passant_square as usize];
            }
        }

        new_hash
    }

    pub fn piece_count(&self) -> i32 {
        let mut count = 0;
        for i in 1..self.piece_locations.len() {
            count += self.piece_locations[i].len();
        }
        count as i32
    }

    pub fn check_for_draw(&self) -> bool {
        if self.move_rep_count >= 50 {
            log("draw by 50 move rep");
            return true;
        }

        if !self.white_turn { // white's last move cannot be a draw
            return false;
        }

        if self.piece_count() == 2 { // only the kings are left
            return true;
        }

        let mut count = 0;
        for elem in self.repetition_history.iter() {
            if *elem == self.board_hash {
                count += 1;
            }
            if count == 3 {
                log("draw by threefold rep");
                return true; // threefold rep
            }
        }

        false
    }

    pub fn get_piece_value(piece: Piece) -> i32 {
        match piece {
            Piece::Queen_W | Piece::Queen_B => Value::QUEEN,
            Piece::Rook_W | Piece::Rook_B => Value::ROOK,
            Piece::Bishop_W | Piece::Bishop_B => Value::BISHOP,
            Piece::Knight_W | Piece::Knight_B => Value::KNIGHT,
            Piece::Pawn_W | Piece::Pawn_B => Value::PAWN,
            _ => 0
        }
    }

    pub fn count_material(&self, white: bool) -> i32 {
        let mut value = 0;

        let start_index = if white { 8 } else { 2 };
        let end_index = if white {12 } else { 6 };
        for i in start_index..=end_index {
            value += Engine::get_piece_value(Piece::from_num(i)) * self.piece_locations[i as usize].len() as i32; // convert index to a piece (should always be defined and safe here)
        }

        value
    }

    fn read_square_table_value(index: usize, table: &[i32], white: bool) -> i32 {
        if !white {
            return table[63 - index];
        }
        table[index]
    }

    fn evaluate_square_table(&self, piece: Piece, table: &[i32], white: bool) -> i32 {
        if piece == Piece::Empty {
            return 0;
        }

        let mut value = 0;
        for pos in self.piece_locations[piece as usize].iter() {
            value += Engine::read_square_table_value(
                *pos,
                table,
                white
            );
        }

        value
    }

    fn evaluate_square_tables(&self, white: bool, endgame_weight: f32) -> i32 {
        let mut value = 0;

        // ugly
        if white {
            value += self.evaluate_square_table(Piece::Pawn_W, &PAWN_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Rook_W, &ROOK_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Knight_W, &KNIGHT_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Bishop_W, &BISHOP_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Queen_W, &QUEEN_SQUARE_TABLE, white);
            let king_mid_game_value = self.evaluate_square_table(Piece::King_W, &KING_MIDDLE_GAME_SQUARE_TABLE, white);
            value += (king_mid_game_value as f32 * (1.0 - endgame_weight)) as i32;
        } else {
            value += self.evaluate_square_table(Piece::Pawn_B, &PAWN_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Rook_B, &ROOK_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Knight_B, &KNIGHT_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Bishop_B, &BISHOP_SQUARE_TABLE, white);
            value += self.evaluate_square_table(Piece::Queen_B, &QUEEN_SQUARE_TABLE, white);
            let king_mid_game_value = self.evaluate_square_table(Piece::King_B, &KING_MIDDLE_GAME_SQUARE_TABLE, white);
            value += (king_mid_game_value as f32 * (1.0 - endgame_weight)) as i32;
        }

        value
    }

    fn evaluate_end_game_position(endgame_weight: f32, op_king_x: i32, op_king_y: i32, distance: i32) -> i32 {
        let mut score = 0;

        // try to push the enemy king into the corner
        let dist_to_center = i32::abs(op_king_x - 4) + i32::abs(op_king_y - 4);
        score += dist_to_center;

        // try and move kings together
        score += 14 - distance;

        (score as f32  * 20.0 * endgame_weight) as i32
    }

    pub fn evaluate(&self) -> i32 {
        let material_weight = 1;
        let development_weight = 1;

        let white_material = self.count_material(true);
        let black_material = self.count_material(false);
        let white_material_no_pawns = white_material - self.piece_locations[Piece::Pawn_W as usize].len() as i32 * Engine::get_piece_value(Piece::Pawn_W);
        let black_material_no_pawns = black_material - self.piece_locations[Piece::Pawn_B as usize].len() as i32 * Engine::get_piece_value(Piece::Pawn_B);

        let endgame_material_threshold = (Value::ROOK * 2) + Value::BISHOP + Value::KNIGHT;
        let white_end_game_weight = 1.0 - f32::min(1.0, white_material_no_pawns as f32 / endgame_material_threshold as f32);
        let black_end_game_weight = 1.0 - f32::min(1.0, black_material_no_pawns as f32 / endgame_material_threshold as f32);

        let mut white_eval = white_material * material_weight;
        let mut black_eval = black_material * material_weight;

        white_eval += self.evaluate_square_tables(true, white_end_game_weight) * development_weight;
        black_eval += self.evaluate_square_tables(false, white_end_game_weight) * development_weight;

        let white_x = (self.piece_locations[Piece::King_W as usize][0] % 8) as i32;
        let white_y = (self.piece_locations[Piece::King_W as usize][0] as f32 * 0.125) as i32;
        let black_x = (self.piece_locations[Piece::King_B as usize][0] % 8) as i32;
        let black_y = (self.piece_locations[Piece::King_B as usize][0] as f32 * 0.125) as i32;
        let distance_between = i32::abs(white_x - black_x) + i32::abs(white_y - black_y);
        white_eval += Engine::evaluate_end_game_position(white_end_game_weight, black_x, black_y, distance_between);
        black_eval += Engine::evaluate_end_game_position(black_end_game_weight, white_x, white_y, distance_between);

        let mut evaluation = white_eval - black_eval;
        if !self.white_turn {
            evaluation *= -1;
        }

        evaluation
    }

    fn trace_valid_squares(&mut self, index: usize, slope_x: i32, slope_y: i32, white: bool, empty_only: bool, update_pins: bool, x: i32, y: i32, in_array: &mut Vec<usize>) {
        let xy_max = 7;
        let len = self.board.len();

        let mut x = x;
        let mut y = y;
        let mut current_index = index;
        let mut obstructed = false;
        let mut obstructed_index = 0;
        while current_index < len {
            if current_index != index {
                if !obstructed {
                    if empty_only {
                        if self.board[current_index] == Piece::Empty {
                            in_array.push(current_index);
                        } else { break; }
                    } else if self.board[current_index] == Piece::Empty ||
                              (white && (self.board[current_index] as u8) < 7) ||
                              (!white && (self.board[current_index] as u8) >= 7) {
                        in_array.push(current_index);
                    }
                    obstructed = self.board[current_index] != Piece::Empty;
                    obstructed_index = current_index;
                } else if update_pins {
                    // if we are tracing a white piece, look for a black piece blocking the way of the black king
                    if self.board[current_index] == Piece::King_W ||
                       self.board[current_index] == Piece::King_B ||
                       self.board[current_index] == Piece::Empty {
                        if white && self.board[current_index] == Piece::King_B && (self.board[current_index] as u8) < 7 {
                            self.pinned_pieces.push(obstructed_index);
                            break;
                        } else if !white && self.board[current_index] == Piece::King_W && (self.board[current_index] as u8) >= 7 {
                            self.pinned_pieces.push(obstructed_index);
                            break;
                        }
                    } else { break; }
                } else { break; }
            }

            if slope_x == -1 && x == 0 { break; }
            if slope_x == 1 && x == xy_max { break; }
            if slope_y == -1 && y == 0 { break; }
            if slope_y == 1 && y == xy_max { break; }

            x += slope_x;
            y += slope_y;
            current_index += (slope_x + (slope_y * 8)) as usize;
        }
    }

    #[allow(unused_assignments)]
    fn get_valid_squares(&mut self, index: usize, piece: Piece, attack_only: bool, update_pins: bool, in_array: &mut Vec<usize>) {
        let x = index as i32 % 8;
        let y = (index as f32 * 0.125) as i32; // 0.125 = 1/8
        let xy_max: i32 = 7;
        let is_white = piece as u8 >= 7;

        match piece {
            Piece::Rook_W | Piece::Rook_B => {
                self.trace_valid_squares( // right
                    index,
                    1,
                    0,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // left
                    index,
                    -1,
                    0,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down
                    index,
                    0,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // up
                    index,
                    0,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
            },
            Piece::Queen_W | Piece::Queen_B => {
                self.trace_valid_squares( // right
                    index,
                    1,
                    0,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // left
                    index,
                    -1,
                    0,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down
                    index,
                    0,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // up
                    index,
                    0,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // up right
                    index,
                    1,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // up left
                    index,
                    -1,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down right
                    index,
                    1,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down left
                    index,
                    -1,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
            },
            Piece::Bishop_W | Piece::Bishop_B => {
                self.trace_valid_squares( // up right
                    index,
                    1,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // up left
                    index,
                    -1,
                    -1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down right
                    index,
                    1,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
                self.trace_valid_squares( // down left
                    index,
                    -1,
                    1,
                    is_white,
                    false,
                    update_pins,
                    x,
                    y,
                    in_array
                );
            },
            Piece::Pawn_W | Piece::Pawn_B => {
                let mut to: usize = 0;
                let min = if is_white { 1 } else { 7 };
                let max = if is_white { 6 } else { 12 };
                let x_min = x >= 1;
                let x_max = x < xy_max;
                let offset = 8;
                let start_y = if is_white { 6 } else { 1 };

                if is_white { to = index - offset; } else { to = index + offset; }          if !attack_only && (self.board[to] == Piece::Empty) { in_array.push(to); }
                if is_white { to = index - offset * 2; } else { to = index + offset * 2; }  if !attack_only && y == start_y && (self.board[to] == Piece::Empty && self.board[if is_white { to + offset } else { to - offset }] == Piece::Empty) { in_array.push(to); }
                if is_white { to = index - offset + 1; } else { to = index + offset + 1; }  if x_max && (((attack_only || self.board[to] != Piece::Empty) && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max))) || to as i32 == self.en_passant_square) { in_array.push(to); }
                if is_white { to = index - offset - 1; } else { to = index + offset - 1; }  if x_min && (((attack_only || self.board[to] != Piece::Empty) && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max))) || to as i32 == self.en_passant_square) { in_array.push(to); }
            },
            Piece::King_W | Piece::King_B => {
                let mut to: usize = 0;
                let min = if is_white { 1 } else { 7 };
                let max = if is_white { 6 } else { 12 };
                let x_min = x >= 1;
                let x_max = x < xy_max;
                let y_min = y >= 1;
                let y_max = y < xy_max;

                to = index - 9; if x_min && y_min && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index - 8; if y_min &&          (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index - 7; if x_max && y_min && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index - 1; if x_min &&          (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index + 1; if x_max &&          (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index + 7; if x_min && y_max && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index + 8; if y_max &&          (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
                to = index + 9; if x_max && y_max && (self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max)) { in_array.push(to); }
            },
            Piece::Knight_W | Piece::Knight_B => {
                let mut to: usize = 0;
                let min = if is_white { 1 } else { 7 };
                let max = if is_white { 6 } else { 12 };

                if x >= 2 {
                    if y >= 1 {
                        to = index - 10; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                    if y <= xy_max - 1 {
                        to = index + 6;  if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                }
                if x <= xy_max - 2 {
                    if y <= xy_max - 1 {
                        to = index + 10; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                    if y >= 1 {
                        to = index - 6;  if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                }
                if y >= 2 {
                    if x >= 1 {
                        to = index - 17; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                    if x <= xy_max - 1 {
                        to = index - 15; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                }
                if y <= xy_max - 2 {
                    if x <= xy_max - 1 {
                        to = index + 17; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                    if x >= 1 {
                        to = index + 15; if self.board[to] == Piece::Empty || ((self.board[to] as u8) >= min && (self.board[to] as u8) <= max) { in_array.push(to); }
                    }
                }
            },

            _ => {}
        }
    }

    fn get_attacked_squares(&mut self, white: bool, to_index: i32, update_pins: bool, in_array: &mut Vec<usize>) {
        let start_index: usize = if white { 1 } else { 7 };
        let end_index: usize = if white { 6 } else { 12 };
        for i in start_index..=end_index {
            let len = self.piece_locations[i].len();
            for j in 0..len {
                if self.piece_locations[i][j] as i32 == to_index { // when searching for valid moves, instead of modifying the piece dictionaries, just ignore any piece that would have been captured
                    continue;
                }
                self.get_valid_squares(
                    self.piece_locations[i][j],
                    Piece::from_num(i as i32),
                    true,
                    update_pins,
                    in_array
                );
            }
        }
    }

    // todo: do not trace if we know castling isnt possible
    fn get_valid_castle_squares(&mut self, attacked_squares: &[usize], in_array: &mut Vec<EvalMove>) {
        let mut traced: Vec<usize> = vec![];
        if self.white_turn {
            self.trace_valid_squares(
                60,
                1,
                0,
                true,
                true,
                false,
                4,
                7,
                &mut traced
            );
            if !(self.castle_status & CastleStatus::WHITE_KING).is_empty() && self.board[63] == Piece::Rook_W && traced.len() == 2 {
                if !attacked_squares.contains(&60) && !attacked_squares.contains(&61) && !attacked_squares.contains(&62) {
                    in_array.push(EvalMove {
                        from: 60,
                        to: 62,
                        data: Piece::Empty as i32,
                        score: 0
                    });
                }
            }

            traced.clear();

            self.trace_valid_squares(
                60,
                -1,
                0,
                true,
                true,
                false,
                4,
                7,
                &mut traced
            );
            if !(self.castle_status & CastleStatus::WHITE_QUEEN).is_empty() && self.board[56] == Piece::Rook_W && traced.len() == 3 {
                if !attacked_squares.contains(&60) && !attacked_squares.contains(&59) && !attacked_squares.contains(&58) {
                    in_array.push(EvalMove {
                        from: 60,
                        to: 58,
                        data: Piece::Empty as i32,
                        score: 0
                    });
                }
            }
        } else {
            self.trace_valid_squares(
                4,
                1,
                0,
                false,
                true,
                false,
                4,
                0,
                &mut traced
            );
            if !(self.castle_status & CastleStatus::BLACK_KING).is_empty() && self.board[7] == Piece::Rook_B && traced.len() == 2 {
                if !attacked_squares.contains(&4) && !attacked_squares.contains(&5) && !attacked_squares.contains(&6) {
                    in_array.push(EvalMove {
                        from: 4,
                        to: 6,
                        data: Piece::Empty as i32,
                        score: 0
                    });
                }
            }

            traced.clear();

            self.trace_valid_squares(
                4,
                -1,
                0,
                false,
                true,
                false,
                4,
                0,
                &mut traced
            );
            if !(self.castle_status & CastleStatus::BLACK_QUEEN).is_empty() && self.board[0] == Piece::Rook_B && traced.len() == 3 {
                if !attacked_squares.contains(&4) && !attacked_squares.contains(&3) && !attacked_squares.contains(&2) {
                    in_array.push(EvalMove {
                        from: 4,
                        to: 2,
                        data: Piece::Empty as i32,
                        score: 0
                    });
                }
            }
        }
    }

    pub fn is_in_check(&mut self, white: bool) -> bool {
        let mut attacked_squares: Vec<usize> = vec![];
        self.get_attacked_squares(
            white,
            -1,
            false,
            &mut attacked_squares
        );
        self.is_in_check_attacked_squares(
            white,
            &attacked_squares
        )
    }

    fn is_in_check_attacked_squares(&self, white: bool, attacked_squares: &[usize]) -> bool {
        (white && attacked_squares.contains(&self.piece_locations[Piece::King_W as usize][0])) || (!white && attacked_squares.contains(&self.piece_locations[Piece::King_B as usize][0]))
    }

    // cannot be pub since wasm_bindgen doesnt support returning struct vecs
    fn get_all_valid_moves(&mut self, captures_only: bool, attacked_squares: &mut Vec<usize>) -> Vec<EvalMove> {
        let mut all_valid: Vec<EvalMove> = vec![];

        // todo: this doesnt always work since there might be no attacked squares and cause an extra check
        if attacked_squares.len() == 0 {
            self.pinned_pieces.clear();
            self.get_attacked_squares(
                self.white_turn,
                -1,
                true,
                attacked_squares
            );
        }

        if !captures_only {
            self.get_valid_castle_squares(
                attacked_squares,
                &mut all_valid
            );
        }

        let in_check = self.is_in_check_attacked_squares(self.white_turn, &attacked_squares);
        let start_index = if self.white_turn { 7 } else { 1 };
        let end_index = if self.white_turn { 12 } else { 6 };
        let mut local_valid: Vec<usize> = vec![];
        let mut local_attacked: Vec<usize> = vec![];
        for i in start_index..=end_index {
            let len = self.piece_locations[i].len();
            let piece: Piece = Piece::from_num(i as i32);

            for j in 0..len {
                let location = self.piece_locations[i][j];

                local_valid.clear();
                self.get_valid_squares(
                    location,
                    piece,
                    captures_only,
                    false,
                    &mut local_valid
                );

                // make some assumptions but for some instances, simulate the move and do a double check that we arent being put in check
                let is_pinned = self.pinned_pieces.contains(&location);
                let local_valid_len = local_valid.len();
                for k in 0..local_valid_len {
                    let checking_index = local_valid[k];

                    if captures_only && self.board[checking_index] == Piece::Empty {
                        continue;
                    }

                    if in_check || is_pinned || piece == Piece::King_W || piece == Piece::King_B {
                        // move the piece
                        let piece_backup = self.board[checking_index];
                        let second_backup = self.board[location];
                        self.board[checking_index] = piece;
                        self.board[location] = Piece::Empty;

                        // get the attacked squares
                        local_attacked.clear();
                        self.get_attacked_squares(
                            self.white_turn,
                            checking_index as i32,
                            false,
                            &mut local_attacked
                        );

                        // move the pieces back
                        self.board[checking_index] = piece_backup;
                        self.board[location] = second_backup;
                        if piece == Piece::King_W || piece == Piece::King_B {
                            if local_attacked.contains(&checking_index) {
                                continue;
                            }
                        } else if self.is_in_check_attacked_squares(self.white_turn, &local_attacked) {
                            continue;
                        }
                    }

                    // add more moves to account for promoting to various pieces
                    let y: usize = (checking_index as f32 * 0.125) as usize;
                    if piece == Piece::Pawn_W && y == 0 {
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Queen_W as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Rook_W as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Bishop_W as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Knight_W as i32,
                            score: 0
                        });
                    } else if piece == Piece::Pawn_B && y == 7 {
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Queen_B as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Rook_B as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Bishop_B as i32,
                            score: 0
                        });
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Knight_B as i32,
                            score: 0
                        });
                    } else {
                        all_valid.push(EvalMove {
                            from: location as i32,
                            to: checking_index as i32,
                            data: Piece::Empty as i32,
                            score: 0
                        });
                    }
                }
            }
        }

        all_valid
    }

    pub fn calculate_all_possible_moves(&mut self, depth: i32) -> i32 {
        if depth <= 0 {
            return 1;
        }

        let valid_moves = self.get_all_valid_moves(
            false,
            &mut vec![]
        );

        let mut total_moves = 0;
        let starting_hash = self.board_hash;
        let starting_en_passant = self.en_passant_square;
        let starting_castle_status = self.castle_status;
        let len = valid_moves.len();
        for i in 0..len {
            self.update_castle_status(
                valid_moves[i].from as usize,
                valid_moves[i].to as usize
            );

            self.force_make_move(
                valid_moves[i].from as usize,
                &MoveInfo {
                    index: valid_moves[i].to as usize,
                    data: Piece::from_num(i as i32)
                },
                false
            );

            let mut stored_deltas = vec![];
            swap(&mut stored_deltas, &mut self.board_deltas);

            self.white_turn = !self.white_turn;
            self.board_hash = self.update_hash(
                stored_deltas.as_slice(),
                starting_hash,
                starting_en_passant,
                starting_castle_status
            );

            total_moves += self.calculate_all_possible_moves(depth - 1);

            self.unmake_move(stored_deltas.as_slice());
            self.board_hash = starting_hash;
            self.en_passant_square = starting_en_passant;
            self.castle_status = starting_castle_status;
        }

        total_moves
    }

    fn predict_and_order_moves(&self, moves: &mut Vec<EvalMove>, attacked_squares: &Vec<usize>) {
        let len = moves.len();

        for i in 0..len {
            let mut score = 0;
            let moving_piece = self.board[moves[i].from as usize];
            let capturing_piece = self.board[moves[i].to as usize];
            let promoting = Piece::from_num(moves[i].data);

            if capturing_piece != Piece::Empty {
                score += 10 * Engine::get_piece_value(capturing_piece) - Engine::get_piece_value(moving_piece);
            }

            // deprioritize moving into attacked squares
            if attacked_squares.contains(&(moves[i].to as usize)) {
                score -= Engine::get_piece_value(moving_piece);
            }

            // score promotion moves
            if moving_piece == Piece::Pawn_W || moving_piece == Piece::Pawn_B {
                score += Engine::get_piece_value(promoting);
            }

            moves[i].score = score;

            let mut index = i;
            let current_elem = moves[index];
            while index > 0 && current_elem.score > moves[index - 1].score {
                moves[index] = moves[index - 1];
                index -= 1;
            }
            moves[index] = current_elem;
        }

        //moves.sort_by_key(|a| a.score);
    }

    pub fn find_best_move(&mut self, can_cancel: bool, depth: i32, offset: i32, alpha: i32, beta: i32) -> i32 {
        let mut alpha = alpha;
        let mut beta = beta;

        if can_cancel && now("") - self.search_start_time >= self.search_max_time {
            return 0;
        }

        if depth <= 0 {
           return self.quiescence_search(alpha, beta);
           //return self.evaluate();
        }

        if offset > 0 {
            // detect any repetition and assume a draw is coming (return a 0 draw score)
            if self.repetition_history.contains(&self.board_hash) {
                return 0;
            }
        }

        alpha = max(alpha, i32::MIN + offset + 1);
        beta = min(beta, i32::MAX - offset - 1);
        if alpha >= beta {
            return alpha;
        }

        match self.saved_evaluations.get(&self.board_hash) {
            Some(saved_eval) => {
                let mut should_return = false;
                if saved_eval.depth >= depth {
                    if saved_eval.saved_type == SavedEvalType::Exact { // exact eval was saved so just return it
                        should_return = true;
                    } else if saved_eval.saved_type == SavedEvalType::Alpha && saved_eval.eval <= alpha { // if we are storing the lower bound, only search if it is greater than the current lower bound
                        should_return = true;
                    } else if saved_eval.saved_type == SavedEvalType::Beta && saved_eval.eval >= beta { // if we are storing the upper bound, only search if it is less than the current upper bound
                        should_return = true;
                    }
                }
                if should_return {
                    if offset == 0 {
                        self.best_move_this_iteration = saved_eval.best_move;
                        self.best_move_this_iteration.score = saved_eval.eval;
                    }
                    return saved_eval.eval;
                }
            },
            None => {}
        }

        self.pinned_pieces.clear();
        let mut attacked_squares: Vec<usize> = vec![];
        self.get_attacked_squares(
            self.white_turn, 
            -1, 
            true,
            &mut attacked_squares
        );
        let mut valid_moves = self.get_all_valid_moves(
            false,
            &mut attacked_squares
        );

        if valid_moves.len() == 0 { // either checkmate or stalemate
            let in_check = self.is_in_check_attacked_squares(
                self.white_turn,
                &attacked_squares
            );
            if in_check {
                return i32::MIN + offset; // checkmate, worst possible move
            } else {
                return 0; // stalemate, draw
            }
        }
        self.predict_and_order_moves(
            &mut valid_moves,
            &attacked_squares
        );

        let starting_hash = self.board_hash;
        let starting_en_passant = self.en_passant_square;
        let starting_castle_status = self.castle_status;
        let mut best_move_for_this_position: EvalMove = Default::default();
        let mut saving_type = SavedEvalType::Alpha;
        for mov in valid_moves.iter() {
            // make the move (todo: move to function)
            self.update_castle_status(
                mov.from as usize,
                mov.to as usize
            );
            self.force_make_move(
                mov.from as usize, 
                &MoveInfo {
                    index: mov.to as usize,
                    data: Piece::from_num(mov.data)
                },
                false
            );
            let mut stored_deltas = vec![];
            swap(&mut stored_deltas, &mut self.board_deltas);

            self.white_turn = !self.white_turn;
            self.board_hash = self.update_hash(
                stored_deltas.as_slice(),
                starting_hash,
                starting_en_passant,
                starting_castle_status
            );

            let evaluation = -1 * self.find_best_move(
                can_cancel, 
                depth - 1,
                offset + 1,
                -beta,
                -alpha
            );

            // unmake the move
            self.unmake_move(&stored_deltas);
            self.board_hash = starting_hash;
            self.en_passant_square = starting_en_passant;
            self.castle_status = starting_castle_status;

            // calc alpha & beta
            if evaluation >= beta {
                self.saved_evaluations.insert(
                    self.board_hash,
                    EvaluationData {
                        total_moves: 0,
                        depth,
                        best_move: best_move_for_this_position,
                        saved_type: SavedEvalType::Beta,
                        eval: beta
                    }
                );
                return beta;
            }
            if evaluation > alpha { // best move found
                alpha = evaluation;
                best_move_for_this_position = *mov;
                saving_type = SavedEvalType::Exact;

                if offset == 0 {
                    self.best_move_this_iteration = best_move_for_this_position;
                    self.best_move_this_iteration.score = evaluation;
                    self.moves_found_this_iteration.push(DebugMoveOutput {
                        mov: self.best_move_this_iteration,
                        piece: self.board[self.best_move_this_iteration.from as usize] as i32,
                        capture: if self.board[self.best_move_this_iteration.to as usize] != Piece::Empty { 1 } else { 0 }
                    });
                }
            }
        }

        self.saved_evaluations.insert(
            self.board_hash,
            EvaluationData {
                total_moves: 0,
                depth,
                best_move: best_move_for_this_position,
                saved_type: saving_type,
                eval: alpha
            }
        );
        
        alpha
    }

    pub fn find_best_move_iterative(&mut self) {
        self.search_start_time = now("");
        let max_depth = 30;
        let mut last_completed_depth = 0;

        for i in 1..=max_depth {
            self.find_best_move(
                true,
                i,
                0,
                i32::MIN,
                i32::MAX
            );

            if now("") - self.search_start_time >= self.search_max_time { // search aborted so dont update move
                break;
            }

            last_completed_depth = i;
            self.best_move = self.best_move_this_iteration;
            swap(&mut self.moves_found_this_iteration, &mut self.moves_found_this_turn);
            self.moves_found_this_iteration.clear();

            // update eval on frontend if this is being run in the eval worker
            post_eval_message("", if self.white_turn { self.best_move.score } else { -self.best_move.score });

            if self.best_move.score >= 99999999 { // mate
                break;
            }
        }

        self.depth_searched_last_turn = last_completed_depth;
    }

    // search until the position is 'quiet' (no captures remaining)
    pub fn quiescence_search(&mut self, alpha: i32, beta: i32) -> i32 {
        let evaluation = self.evaluate(); // evaluate first to prevent forcing a bad capture when there may have been better non capture moves
        let mut alpha = alpha;

        if evaluation >= beta {
            return beta;
        }
        if evaluation > alpha {
            alpha = evaluation;
        }

        self.pinned_pieces.clear();
        let mut attacked_squares: Vec<usize> = vec![];
        self.get_attacked_squares(
            self.white_turn, 
            -1, 
            true,
            &mut attacked_squares
        );
        let mut valid_moves = self.get_all_valid_moves(
            true,
            &mut attacked_squares
        );

        self.predict_and_order_moves(
            &mut valid_moves,
            &attacked_squares
        );

        let starting_en_passant = self.en_passant_square;
        for mov in valid_moves.iter() {
            // make the move (todo: move to function)
            // dont update hash or castle status because they aren't relevant here
            self.force_make_move(
                mov.from as usize, 
                &MoveInfo {
                    index: mov.to as usize,
                    data: Piece::from_num(mov.data)
                },
                false
            );
            let mut stored_deltas = vec![];
            swap(&mut stored_deltas, &mut self.board_deltas);

            self.white_turn = !self.white_turn;

            let evaluation = -1 * self.quiescence_search(
                -beta,
                -alpha
            );

            // unmake the move
            self.unmake_move(&stored_deltas);
            self.en_passant_square = starting_en_passant;

            if evaluation >= beta {
                return beta;
            }
            if evaluation > alpha {
                alpha = evaluation;
            }
        }

        alpha
    }

    pub fn eval_bot_move(&mut self, depth: i32) -> bool {
        if self.check_for_draw() {
            return false;
        }

        let start_time = now("");
        self.moves_found_this_iteration.clear();
        self.moves_found_this_turn.clear();

        self.find_best_move(
            false,
            depth,
            0,
            i32::MIN,
            i32::MAX
        );
        if self.best_move.to == self.best_move_this_iteration.to && self.best_move.from == self.best_move_this_iteration.from { // repeating the same move from the last evaluatioin
            log("Attempting to make the same move, aborting");
            return false;
        } else {
            self.best_move = self.best_move_this_iteration;
        }

        swap(&mut self.moves_found_this_turn, &mut self.moves_found_this_iteration);
        self.depth_searched_last_turn = depth;
        self.castled_this_turn = self.update_castle_status(
            self.best_move.from as usize,
            self.best_move.to as usize
        );
        self.piece_captured_this_turn = self.board[self.best_move.to as usize] != Piece::Empty;
        self.force_make_move(
            self.best_move.from as usize,
            &MoveInfo {
                index: self.best_move.to as usize,
                data: Piece::from_num(self.best_move.data)
            },
            true
        );

        let time_elapsed = now("") - start_time;
        self.time_taken_last_turn = time_elapsed; // ms

        true
    }

    pub fn eval_bot_move_iterative(&mut self) -> bool {
        if self.check_for_draw() {
            return false;
        }

        let start_time = now("");
        let last_move = self.best_move;
        self.moves_found_this_iteration.clear();
        self.moves_found_this_turn.clear();

        self.find_best_move_iterative();
        if self.best_move.to == last_move.to && self.best_move.from == last_move.from { // repeating the same move from the last evaluatioin
            log("Attempting to make the same move, aborting");
            return false;
        }

        self.castled_this_turn = self.update_castle_status(
            self.best_move.from as usize,
            self.best_move.to as usize
        );
        self.piece_captured_this_turn = self.board[self.best_move.to as usize] != Piece::Empty;
        self.force_make_move(
            self.best_move.from as usize,
            &MoveInfo {
                index: self.best_move.to as usize,
                data: Piece::from_num(self.best_move.data)
            },
            true
        );

        let time_elapsed = now("") - start_time;
        self.time_taken_last_turn = time_elapsed; // ms

        true
    }

    pub fn attempt_move(&mut self, from_index: usize, to_index: usize) -> bool {
        let moving_piece = self.board[from_index];

        if self.check_for_draw() {
            return false;
        }

        // no-op moves
        if from_index == to_index || moving_piece == Piece::Empty {
            return false;
        }

        // only move correct color pieces on correct turn
        if (self.white_turn && moving_piece < Piece::King_W) || (!self.white_turn && moving_piece > Piece::Pawn_B) {
            return false;
        }

        let valid_moves = self.get_all_valid_moves(false, &mut vec![]);
        if !valid_moves.iter().any(|m| m.from == from_index as i32 && m.to == to_index as i32) {
            return false;
        }

        self.castled_this_turn = self.update_castle_status(from_index, to_index);
        self.piece_captured_this_turn = self.board[to_index] != Piece::Empty; // todo: en passant capture noise doesn't work with this
        self.force_make_move(
            from_index,
            &MoveInfo {
                index: to_index,
                data: if self.white_turn { Piece::Queen_W } else { Piece::Queen_B } // auto promote to queen when possible
            },
            true
        );

        true
    }

    pub fn board_ptr(&self) -> *const Piece {
        self.board.as_ptr()
    }

    pub fn set_board(&mut self, board: Vec<i32>) {
        for (i, elem) in board.iter().enumerate() {
            self.board[i] = Piece::from_num(*elem);
        }
    }

    pub fn valid_moves_ptr(&self) -> *const EvalMove {
        self.all_valid_moves.as_ptr()
    }

    pub fn valid_moves_len(&self) -> usize {
        self.all_valid_moves.len()
    }

    pub fn white_turn(&self) -> bool {
        self.white_turn
    }

    pub fn set_white_turn(&mut self, white_turn: bool) {
        self.white_turn = white_turn;
    }

    pub fn castle_status(&self) -> u8 {
        unsafe { transmute(self.castle_status) }
    }

    pub fn set_castle_status(&mut self, castle_status: u8) {
        self.castle_status = unsafe { transmute(castle_status) };
    }

    pub fn en_passant_square(&self) -> i32 {
        self.en_passant_square
    }

    pub fn set_en_passant_square(&mut self, en_passant_square: i32) {
        self.en_passant_square = en_passant_square;
    }

    pub fn move_count(&self) -> i32 {
        self.move_count
    }

    pub fn set_move_count(&mut self, move_count: i32) {
        self.move_count = move_count;
    }

    pub fn move_rep_count(&self) -> i32 {
        self.move_rep_count
    }

    pub fn set_move_rep_count(&mut self, move_rep_count: i32) {
        self.move_rep_count = move_rep_count;
    }

    pub fn repetition_history_ptr(&self) -> *const u64 {
        self.repetition_history.as_ptr()
    }

    pub fn repetition_history_len(&self) -> usize {
        self.repetition_history.len()
    }

    pub fn set_repetition_history(&mut self, repetition_history: Vec<u64>) {
        self.repetition_history.clear();
        for elem in repetition_history.iter() {
            self.repetition_history.push(*elem);
        }
    }

    pub fn piece_locations(&self, piece: i32) -> Vec<i32> {
        let mut list: Vec<i32> = vec![];
        for elem in self.piece_locations[piece as usize].iter() {
            list.push(*elem as i32)
        }
        list
    }

    pub fn set_piece_locations(&mut self, piece: i32, locations: Vec<i32>) {
        self.piece_locations[piece as usize].clear();
        for elem in locations.iter() {
            self.piece_locations[piece as usize].push(*elem as usize);
        }
    }

    pub fn in_check(&self) -> bool {
        self.in_check
    }

    pub fn piece_captured_this_turn(&self) -> bool {
        self.piece_captured_this_turn
    }

    pub fn castled_this_turn(&self) -> bool {
        self.castled_this_turn
    }

    pub fn best_move(&self) -> EvalMove {
        self.best_move
    }

    pub fn time_taken_last_turn(&self) -> u32 {
        self.time_taken_last_turn
    }

    pub fn depth_searched_last_turn(&self) -> i32 {
        self.depth_searched_last_turn
    }

    pub fn set_depth_searched_last_turn(&mut self, depth: i32) {
        self.depth_searched_last_turn = depth;
    }

    pub fn update_max_search_time(&mut self, time: u32) {
        self.search_max_time = time;
    }

    pub fn moves_found_this_turn_ptr(&self) -> *const DebugMoveOutput {
        self.moves_found_this_turn.as_ptr()
    }

    pub fn moves_found_this_turn_len(&self) -> usize {
        self.moves_found_this_turn.len()
    }
}