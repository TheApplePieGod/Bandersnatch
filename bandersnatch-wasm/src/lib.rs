mod utils;

use wasm_bindgen::prelude::*;
use std::{collections::HashMap, intrinsics::transmute, vec};

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

#[wasm_bindgen]
pub struct EvalMove {
    from: usize,
    to: usize,
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
    repetition_history: Vec<u64>,

    castled_this_turn: bool,
    piece_captured_this_turn: bool,
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
            repetition_history: vec![],

            castled_this_turn: false,
            piece_captured_this_turn: false,
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
    }

    pub fn finish_turn(&mut self) {
        self.white_turn = !self.white_turn;
        self.board_hash = self.hash_board();
        self.board_deltas.clear();

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
            self.piece_locations[Piece::Pawn_W as usize].push(to_index);
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
            self.piece_locations[Piece::Pawn_B as usize].push(to_index);
            self.board_deltas.push(BoardDelta {
                index: -1,
                piece: move_info.data,
                target: to_index as i32
            });
            promoted = true;
        }

        // en passant check
        if to_index == self.en_passant_square as usize { // capturing en passant, so remove the pawn and add a delta
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

        // not sure if board deltas here are necessary, check this?
        if moving_piece == Piece::Pawn_W && from_index - to_index == 16 { // moving two spaces up
            self.en_passant_square = from_index as i32 - 8;
            self.board_deltas.push(BoardDelta {
                index: -1,
                piece: Piece::Empty,
                target: -1
            });
        } else if moving_piece == Piece::Pawn_B && to_index - from_index == 16 { // moving two spaces down
            self.en_passant_square = from_index as i32 + 8;
            self.board_deltas.push(BoardDelta {
                index: -1,
                piece: Piece::Empty,
                target: -1
            });
        } else {
            self.en_passant_square = -1;
        }

        // update moved piece position unless promoted since that is already handled
        if !promoted {
            self.remove_piece(moving_piece, from_index);
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
                                self.piece_locations[piece_as_usize][i] = *self.piece_locations[piece_as_usize].last().unwrap();
                                self.piece_locations[piece_as_usize].pop();
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

    // cannot be pub since wasm_bindgen doesnt support returning struct vecs
    fn get_all_valid_moves(&self, captures_only: bool, attacked_squares: &[usize]) -> Vec<EvalMove> {
        let all_valid: Vec<EvalMove> = vec![]; 

        if attacked_squares.len() == 0 {

        }

        all_valid
    }

    pub fn calculate_all_possible_moves(&self, depth: i32) -> i32 {
        if depth <= 0 {
            return 1;
        }

        let valid_moves = self.get_all_valid_moves(false, &[]);

        let total_moves = 0;



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

        let valid_moves = self.get_all_valid_moves(false, &[]);
        if !valid_moves.iter().any(|m| m.from == from_index && m.to == to_index) {
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
}