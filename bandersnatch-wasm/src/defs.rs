use wasm_bindgen::prelude::*;
use bitflags::bitflags;

pub fn set_panic_hook() {
    // When the `console_error_panic_hook` feature is enabled, we can call the
    // `set_panic_hook` function at least once during initialization, and then
    // we will get better error messages if our code ever panics.
    //
    // For more details see
    // https://github.com/rustwasm/console_error_panic_hook#readme
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

pub struct Value;
impl Value {
    pub const PAWN: i32 = 100;
    pub const KNIGHT: i32 = 300;
    pub const BISHOP: i32 = 300;
    pub const ROOK: i32 = 500;
    pub const QUEEN: i32 = 900;
}

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

impl Piece {
    pub fn from_num(num: i32) -> Piece {
        match num {
            1 => Piece::King_B,
            2 => Piece::Queen_B,
            3 => Piece::Rook_B,
            4 => Piece::Bishop_B,
            5 => Piece::Knight_B,
            6 => Piece::Pawn_B,
            7 => Piece::King_W,
            8 => Piece::Queen_W,
            9 => Piece::Rook_W,
            10 => Piece::Bishop_W,
            11 => Piece::Knight_W,
            12 => Piece::Pawn_W,
            _ => Piece::Empty
        }
    }
}

bitflags! {
    #[wasm_bindgen]
    pub struct CastleStatus: u8 {
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
    pub index: i32, // current location of the piece
    pub piece: Piece,
    pub target: i32 // where the piece is moving to (if appliciable)
}

#[wasm_bindgen]
pub struct MoveInfo {
    pub index: usize, // to_index
    pub data: Piece // promotion
}

// keep everything as i32 for easy reading in js
#[wasm_bindgen]
#[derive(Default, Clone, Copy)]
pub struct EvalMove {
    pub from: i32,
    pub to: i32,
    pub data: i32,
    pub score: i32
}

#[wasm_bindgen]
pub struct DebugMoveOutput {
    pub mov: EvalMove,
    pub piece: i32,
    pub capture: i32,
}

#[wasm_bindgen]
#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SavedEvalType {
    Exact = 0,
    Alpha = 1,
    Beta = 2
}

#[wasm_bindgen]
pub struct EvaluationData {
    pub total_moves: i32,
    pub eval: i32,
    pub best_move: EvalMove,
    pub depth: i32,
    pub saved_type: SavedEvalType,
}

pub const EMPTY_SQUARE_TABLE: [i32; 64] = [
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0
];

pub const PAWN_SQUARE_TABLE: [i32; 64] = [
    0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 25, 25, 10,  5,  5,
    0,  0,  0, 20, 20,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-20,-20, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
];

pub const KNIGHT_SQUARE_TABLE: [i32; 64] = [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
];

pub const BISHOP_SQUARE_TABLE: [i32; 64] = [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
];

pub const ROOK_SQUARE_TABLE: [i32; 64] = [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0
];

pub const QUEEN_SQUARE_TABLE: [i32; 64] = [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
];

pub const KING_MIDDLE_GAME_SQUARE_TABLE: [i32; 64] = [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20
];