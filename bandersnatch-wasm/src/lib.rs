mod utils;

use wasm_bindgen::prelude::*;
use std::{collections::HashMap, intrinsics::transmute, mem::swap, usize, vec};

use bitflags::bitflags;
use rand::Rng;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
extern {
    fn alert(s: &str);

    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub fn greet() {
    alert("Hello, bandersnatch-wasm!");
}

// -----------------------------------------------------------------------------------------
#[wasm_bindgen]
#[allow(non_camel_case_types)]
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Piece {
    Empty = 0,
    King_B = 1,
    Queen_B = 2,
    Rook_B = 3,
    Bishop_B = 4,
    Knight_B = 5,
    Pawn_B = 6,
    King_W = 7,
    Queen_W = 8,
    Rook_W = 9,
    Bishop_W = 10,
    Knight_W = 11,
    Pawn_W = 12
}

pub struct Value;
impl Value {
    pub const PAWN: i32 = 100;
    pub const KNIGHT: i32 = 300;
    pub const BISHOP: i32 = 300;
    pub const ROOK: i32 = 500;
    pub const QUEEN: i32 = 900;
}

bitflags! {
    #[wasm_bindgen]
    struct CastleStatus: u8 {
        const UNSET = 0;
        const WHITE_KING = 1;
        const WHITE_QUEEN = 2;
        const BLACK_KING = 4;
        const BLACK_QUEEN = 8;
    }
}

// setting fields to -1 ignores them
#[wasm_bindgen]
#[derive(Copy, Clone)]
pub struct BoardDelta {
    index: i32, // current location of the piece
    piece: Piece,
    target: i32 // where the piece is moving to (if appliciable)
}

#[wasm_bindgen]
pub struct MoveInfo {
    index: usize, // to_index
    data: Piece // promotion
}

// keep everything as i32 for easy reading in js
#[wasm_bindgen]
pub struct EvalMove {
    from: i32,
    to: i32,
    data: i32,
    score: i32
}

#[wasm_bindgen]
pub struct Engine {
    fen_to_piece_map: HashMap<String, Piece>,
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

    castled_this_turn: bool,
    piece_captured_this_turn: bool,
    in_check: bool,
    all_valid_moves: Vec<EvalMove>,
}

#[wasm_bindgen]
impl Engine {
    pub fn new() -> Engine {
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

            castled_this_turn: false,
            piece_captured_this_turn: false,
            in_check: false,
            all_valid_moves: vec![],
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

    pub fn finish_turn(&mut self) {
        self.white_turn = !self.white_turn;
        self.board_hash = self.hash_board();
        self.board_deltas.clear();
        self.all_valid_moves = self.get_all_valid_moves(false, &mut vec![]);
        self.in_check = self.is_in_check(self.white_turn);

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
        let y: usize = (to_index as f64 * 0.125) as usize; // 0.125 = 1/8
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
                self.remove_piece(Piece::Rook_W, 63);
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
                self.remove_piece(Piece::Rook_W, 56);
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
                self.remove_piece(Piece::Rook_B, 7);
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
                self.remove_piece(Piece::Rook_B, 0);
                self.board[0] = Piece::Empty;
                self.board[3] = Piece::Rook_B;
                castled = true;
            }

            self.castle_status &= !CastleStatus::BLACK_KING;
            self.castle_status &= !CastleStatus::WHITE_QUEEN;
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
                return true; // threefold rep
            }
        }

        false
    }

    pub fn get_piece_value(piece: Piece) -> i32 {
        match piece {
            Piece::Queen_W => Value::QUEEN,
            Piece::Queen_B => Value::QUEEN,

            Piece::Rook_W => Value::ROOK,
            Piece::Rook_B => Value::ROOK,

            Piece::Bishop_W => Value::BISHOP,
            Piece::Bishop_B => Value::BISHOP,

            Piece::Knight_W => Value::KNIGHT,
            Piece::Knight_B => Value::KNIGHT,

            Piece::Pawn_W => Value::PAWN,
            Piece::Pawn_B => Value::PAWN,

            _ => 0
        }
    }

    pub fn count_material(&self, white: bool) -> i32 {
        let mut value = 0;

        let start_index = if white { 8 } else { 2 };
        let end_index = if white {12 } else { 6 };
        for i in start_index..=end_index {
            value += Engine::get_piece_value(unsafe { transmute(i as u8) }) * self.piece_locations[i as usize].len() as i32; // convert index to a piece (should always be defined and safe here)
        }

        value
    }

    pub fn evaluate(&self) -> i32 {
        let material_weight = 1;
        let development_weight = 1;

        let white_material = self.count_material(true);
        let black_material = self.count_material(false);
        let white_material_no_pawns = white_material - self.piece_locations[Piece::Pawn_W as usize].len() as i32 * Engine::get_piece_value(Piece::Pawn_W);
        let black_material_no_pawns = black_material - self.piece_locations[Piece::Pawn_B as usize].len() as i32 * Engine::get_piece_value(Piece::Pawn_B);

        let mut white_eval = white_material * material_weight;
        let mut black_eval = black_material * material_weight;

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

    fn get_valid_squares(&mut self, index: usize, piece: Piece, attack_only: bool, update_pins: bool, in_array: &mut Vec<usize>) {
        let x = index as i32 % 8;
        let y = (index as f64 * 0.125) as i32; // 0.125 = 1/8
        let xy_max: i32 = 7;
        let is_white = piece as u8 >= 7;

        let trace_lines = |engine: &mut Engine, valid_squares: &mut Vec<usize>| {
            engine.trace_valid_squares( // right
                index,
                1,
                0,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // left
                index,
                -1,
                0,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // down
                index,
                0,
                1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // up
                index,
                0,
                -1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
        };

        let trace_diagonals = |engine: &mut Engine, valid_squares: &mut Vec<usize>| {
            engine.trace_valid_squares( // up right
                index,
                1,
                -1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // up left
                index,
                -1,
                -1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // down right
                index,
                1,
                1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
            engine.trace_valid_squares( // down left
                index,
                -1,
                1,
                is_white,
                false,
                update_pins,
                x,
                y,
                valid_squares
            );
        };

        match piece {
            Piece::Rook_W | Piece::Rook_B => {
                trace_lines(self, in_array);
            },
            Piece::Queen_W | Piece::Queen_B => {
                trace_lines(self, in_array);
                trace_diagonals(self, in_array);
            },
            Piece::Bishop_W | Piece::Bishop_B => {
                trace_diagonals(self, in_array);
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
                    unsafe { transmute(i as u8) },
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
            let piece: Piece = unsafe { transmute(i as u8) };

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
                    let y: usize = (checking_index as f64 * 0.125) as usize;
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
                    data: unsafe { transmute(valid_moves[i].data as u8) }
                },
                false
            );

            let mut stored_deltas = vec![];
            // for elem in self.board_deltas.iter() {
            //     stored_deltas.push(*elem);
            // }
            // self.board_deltas.clear();
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

    pub fn valid_moves_ptr(&self) -> *const EvalMove {
        self.all_valid_moves.as_ptr()
    }

    pub fn valid_moves_len(&self) -> usize {
        self.all_valid_moves.len()
    }

    pub fn white_turn(&self) -> bool {
        self.white_turn
    }

    pub fn piece_locations(&self, piece: i32) -> Vec<i32> {
        let mut list: Vec<i32> = vec![];
        for elem in self.piece_locations[piece as usize].iter() {
            list.push(*elem as i32)
        }
        list
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
}