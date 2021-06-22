import bigInt from "big-integer";
import { bishopSquareTable, knightSquareTable, pawnSquareTable, Piece, queenSquareTable, rookSquareTable, Value, getPieceName, EvalMove, EngineCommands, kingMiddleGameSquareTable, EvalCommands, HistoricalBoard, DebugMoveOutput, notationToIndex, indexToNotation, getPieceNameShort, fenToPieceDict, emptySquareTable } from "../definitions";
import { openings } from "./openings";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

interface BoardDelta { // set values to -1 to ignore
    index: number;
    piece: number;
    target: number;
}

interface MoveInfo {
    index: number;
    data: number;
}

interface EvaluationData {
    totalMoves: number;
    eval: number;
    bestMove: EvalMove;
    depth: number;
    type: number;
}

enum SavedEvalTypes {
    Exact = 0,
    Alpha = 1,
    Beta = 2
}

enum CastleStatus { // kingside / queenside
    WhiteKing = 1,
    WhiteQueen = 2,
    BlackKing = 4,
    BlackQueen = 8
}

export class Engine {
    boardSize = 8;
    board: number[] = [];
    boardDelta: BoardDelta[] = [];
    boardHash: bigint = BigInt(0);

    zobristHashTable: bigint[][] = [];
    savedEvaluations: Record<string, EvaluationData> = {};
    evalBestMove: EvalMove = { from: -1, to: -1, data: 0, score: 0 };
    evalBestMoveThisIteration: EvalMove = { from: -1, to: -1, data: 0, score: 0 };
    movesFoundThisTurn: DebugMoveOutput[] = [];
    movesFoundThisIteration: DebugMoveOutput[] = [];
    repetitionHistory: bigint[] = [];

    searchStartTime = 0;
    searchMaxTime = 3000;

    pieceCapturedThisTurn = false;
    castledThisTurn = false;
    inCheck = false;
    timeTakenLastTurn = 0;
    depthSearchedThisTurn = 0;
    currentOpening = "";

    pieceLocations: number[][] = [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
    ]

    moveCount = 0;
    moveRepCount = 0;
    moveList: string[] = [];

    pinnedPieces: number[] = [];
    historicalBoards: HistoricalBoard[] = [];
    historicalIndex = 0;
    whiteTurn = true;
    castleStatus = 0;
    enPassantSquare = -1;
    allValidMoves: EvalMove[] = [];

    startingMaterialWithoutPawns = (Value.Bishop * 2) + (Value.Knight * 2) + (Value.Rook * 2) + Value.Queen;
    startingMaterial = (Value.Pawn * 8) + this.startingMaterialWithoutPawns;
    endgameMaterialThreshold = (Value.Rook * 2) + (Value.Bishop) + (Value.Knight);

    constructor() {
        this.board = [];

        //https://docs.google.com/spreadsheets/d/1fWA-9QW-C8Dc-8LDrEemSligWcprkpKif6cNDs4V_mg/edit#gid=0
        let startingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        //startingFEN = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8"; // position 5
        //startingFEN = "5ppp/4Ppkp/5ppp/8/6q1/5P2/1K6/8 w - - 0 1"; // king in a box
        //startingFEN = "1rk4r/1pp3pp/p2b4/1n3P2/6P1/2nK4/7P/8 b - - 0 1"; // promotion break
        //startingFEN = "r3kb1r/ppp1pppp/2n5/6B1/4P1n1/2N5/PPP2PPP/R2K2NR w - - 0 1"; // fork
        //startingFEN = "rr2kb2/ppp1pppp/2n3n1/7B/B7/2N5/PPP2PPP/R2KR1N1 b - - 0 1"; // pins
        //startingFEN = "2N5/4k2p/p3pp2/6p1/8/P4n1P/4r3/1K1R4 b - - 0 1"; // threefold test
        //startingFEN = "8/8/1N4R1/4p3/2P5/2k2n1P/5r2/2K5 w - - 0 1"; // real threefold
        //startingFEN = "3r4/3r4/3k4/8/8/3K4/8/8 w - - 0 1"; // one sided rook endgame
        //startingFEN = "6k1/5p2/6p1/8/7p/8/6PP/6K1 b - - 0 0"; // hard pawn endgame
        //startingFEN = "4R3/1k6/1p2P1p1/p7/4r3/1P1r4/1K6/2R5 w - - 0 0"; // 4 rooks endgame
        //startingFEN = "r2qr1k1/1p1b1pp1/3p1b1p/3p4/p2NPPP1/4B3/PPPQ2P1/3RR1K1 w - - 0 1"; // pawn structure test
        //startingFEN = "r1b1kb1r/p2pqppp/2p2n2/4N3/1pBnP3/2N5/PPPP1PPP/R1BQ1RK1 w kq - 0 1"; // PVSearch test
        //startingFEN = "8/2p5/8/KP5r/8/8/8/7k b - - 0 1"; // en passant pin test
        //startingFEN = "8/k7/3p4/p2P1p2/P2P1P2/8/8/K7 w - - 0 1"; // hard endgame draw test
        //startingFEN = "8/2N4p/1PK3p1/8/4k3/4P3/1r5P/8 b - - 0 1"; // passed pawn detection test

        // the bigint casts should and do work so just ignore the ts type error

        // initialize the hash table (0-63)
        const maxVal: bigInt.BigNumber = bigInt(2).pow(64).minus(1);
        for (let i = 0; i < 64; i++) {
            this.zobristHashTable.push([]);
            for (let j = 0; j < 12; j++) {
                //@ts-ignore
                this.zobristHashTable[i].push(BigInt(bigInt.randBetween(0, maxVal)));
            }
        }

        // castle values (64)
        let castleValues: bigint[] = [];
        for (let i = 0; i < 4; i++) {
            //@ts-ignore
            castleValues.push(BigInt(bigInt.randBetween(0, maxVal)));
        }
        this.zobristHashTable.push(castleValues);
        
        // turn (65)
        //@ts-ignore
        this.zobristHashTable.push([BigInt(bigInt.randBetween(0, maxVal))]);

        // en passant (66)
        let enPassantSquares: bigint[] = [];
        for (let i = 0; i < 64; i++) {
            //@ts-ignore
            enPassantSquares.push(BigInt(bigInt.randBetween(0, maxVal)));
        }
        this.zobristHashTable.push(enPassantSquares);

        this.board = this.parseFEN(startingFEN);
        this.boardHash = this.hashBoard();
        this.repetitionHistory.push(this.boardHash);
        this.historicalBoards.push(this.createHistoricalBoard());
        this.allValidMoves = this.getAllValidMoves();
    }

    createHistoricalBoard = () => {
        let newPieceLocations: number[][] = [...this.pieceLocations]
        for (let i = 0; i < newPieceLocations.length; i++) {
            newPieceLocations[i] = [...newPieceLocations[i]]
        }
        
        return ({
            board:  [...this.board],
            whiteTurn: this.whiteTurn,
            castleStatus: this.castleStatus,
            enPassantSquare: this.enPassantSquare,
            pieceLocations: newPieceLocations,
            moveCount: this.moveCount,
            moveRepCount: this.moveRepCount,
            repetitionHistory: [...this.repetitionHistory],
            moveList: [...this.moveList]
        });
    }

    useHistoricalBoard = (historicalBoard: HistoricalBoard) => {
        this.board = [...historicalBoard.board];
        this.whiteTurn = historicalBoard.whiteTurn;
        this.castleStatus = historicalBoard.castleStatus;
        this.enPassantSquare = historicalBoard.enPassantSquare;
        this.pieceLocations = [...historicalBoard.pieceLocations];
        for (let i = 0; i < this.pieceLocations.length; i++) {
            this.pieceLocations[i] = [...this.pieceLocations[i]]
        }
        this.moveCount = historicalBoard.moveCount;
        this.moveRepCount = historicalBoard.moveRepCount;
        this.repetitionHistory = [...historicalBoard.repetitionHistory];
        this.moveList = [...historicalBoard.moveList];
        this.boardHash = this.hashBoard();
        this.savedEvaluations = {};
        this.boardDelta = [];
        this.evalBestMove = {} as EvalMove;
        this.movesFoundThisTurn = [];
        this.allValidMoves = this.getAllValidMoves();
    }

    stepBack = () => {
        if (Math.abs(this.historicalIndex) < this.historicalBoards.length - 1) {
            this.historicalIndex--;

            const historicalBoard = this.historicalBoards[this.historicalBoards.length - 1 + this.historicalIndex];
            this.useHistoricalBoard(historicalBoard);
        }
    }

    stepForward = () => {
        if (this.historicalIndex < 0) {
            this.historicalIndex++;
            const historicalBoard = this.historicalBoards[this.historicalBoards.length - 1 + this.historicalIndex];
            this.useHistoricalBoard(historicalBoard);
        }
    }

    undoMove = () => {
        if (this.historicalBoards.length > 1 && this.historicalIndex == 0) {
            this.historicalIndex = 0;
            const historicalBoard = this.historicalBoards[this.historicalBoards.length - 2];
            this.useHistoricalBoard(historicalBoard);
            this.historicalBoards.pop();
        }
    }

    hashBoard = () => {
        let hash = BigInt(0);
        
        // board values
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] != Piece.Empty) {
                const j = this.board[i] - 1;
                hash = hash ^ this.zobristHashTable[i][j];
            }
        }

        // castle values
        if ((this.castleStatus & CastleStatus.WhiteKing))
            hash = hash ^ this.zobristHashTable[64][0];
        if ((this.castleStatus & CastleStatus.WhiteQueen))
            hash = hash ^ this.zobristHashTable[64][1];
        if ((this.castleStatus & CastleStatus.BlackKing))
            hash = hash ^ this.zobristHashTable[64][2];
        if ((this.castleStatus & CastleStatus.BlackQueen))
            hash = hash ^ this.zobristHashTable[64][3];

        // turn
        if (this.whiteTurn)
            hash = hash ^ this.zobristHashTable[65][0];

        // en passant
        if (this.enPassantSquare != -1)
            hash = hash ^ this.zobristHashTable[66][this.enPassantSquare];

        return hash;
    }

    parseFEN = (fenString: string) => {
        let board: number[] = [];
        for (let i = 0; i < this.boardSize * this.boardSize; i++) {
            board.push(Piece.Empty);
        }

        const fields = fenString.split(' ');
        const ranks = fields[0].split('/');

        let boardIndex = 0;
        for (let r = 0; r < ranks.length; r++) {
            const terms = ranks[r].split('');
            for (let t = 0; t < terms.length; t++) {
                const numberVal = parseInt(terms[t]);
                if (isNaN(numberVal)) {
                    const piece = fenToPieceDict[terms[t]];
                    board[boardIndex] = piece;

                    this.pieceLocations[piece].push(boardIndex);

                    boardIndex++;
                }
                else
                    boardIndex += numberVal;
            }
        }

        this.whiteTurn = fields[1] == 'w';
        this.castleStatus = 0;

        if (fields[2].includes('K'))
            this.castleStatus |= CastleStatus.WhiteKing;
        if (fields[2].includes('Q'))
            this.castleStatus |= CastleStatus.WhiteQueen;
        if (fields[2].includes('k'))
            this.castleStatus |= CastleStatus.BlackKing;
        if (fields[2].includes('q'))
            this.castleStatus |= CastleStatus.BlackQueen;

        if (fields[3] != '-')
            this.enPassantSquare = notationToIndex(parseInt(fields[3][1]), fields[3][0]);

        this.moveRepCount = parseInt(fields[4]);

        this.moveCount = parseInt(fields[5]) * 2 - 2;

        return board;
    }

    traceValidSquares = (index: number, slopeX: number, slopeY: number, white: boolean, onlyEmpty: boolean, updatePins: boolean, x: number, y: number, attackOnly: boolean, inArray: number[]) => {
        let currentIndex = index;
        const xyMax = this.boardSize - 1;
        const length = this.board.length;

        let obstructed = false;
        let obstructedIndex = 0;
        while (currentIndex >= 0 && currentIndex < length) {
            if (currentIndex != index) {
                if (!obstructed) {
                    if (onlyEmpty) {
                        if (this.board[currentIndex] == Piece.Empty)
                            inArray.push(currentIndex);
                        else
                            break;
                    } else if (!attackOnly && (this.board[currentIndex] == Piece.Empty) || (white && this.board[currentIndex] < 7) || (!white && this.board[currentIndex] >= 7)) {
                        inArray.push(currentIndex);
                    }
                    obstructed = this.board[currentIndex] != Piece.Empty;
                    obstructedIndex = currentIndex;
                }
                else if (updatePins) {
                    // if we are tracing a white piece, look for a black piece blocking the way of the black king
                    if (this.board[currentIndex] == Piece.King_W || this.board[currentIndex] == Piece.King_B || this.board[currentIndex] == Piece.Empty) {
                        if (white && this.board[currentIndex] == Piece.King_B && this.board[obstructedIndex] < 7) {
                            this.pinnedPieces.push(obstructedIndex);
                            break;
                        }
                        else if (!white && this.board[currentIndex] == Piece.King_W && this.board[obstructedIndex] >= 7) {
                            this.pinnedPieces.push(obstructedIndex);
                            break;
                        }
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }

            if (slopeX == -1 && x == 0)
                break;
            if (slopeX == 1 && x == xyMax)
                break;
            if (slopeY == -1 && y == 0)
                break;
            if (slopeY == 1 && y == xyMax)
                break;

            x += slopeX;
            y += slopeY;
            currentIndex += slopeX + (slopeY * this.boardSize);
        }
    }

    // todo: attack only should apply on slide pieces as well
    getValidSquares = (index: number, piece: number, attackOnly: boolean, updatePins: boolean, inArray: number[]) => {
        const x = index % this.boardSize;
        const y = (index / this.boardSize) << 0;
        const xyMax = this.boardSize - 1;

        const isWhite = piece >= 7;
        switch (piece) {
            case Piece.Rook_W:
            case Piece.Rook_B:
                this.traceValidSquares(index, 1, 0, isWhite, false, updatePins, x, y, attackOnly, inArray); // right
                this.traceValidSquares(index, -1, 0, isWhite, false, updatePins, x, y, attackOnly, inArray); // left
                this.traceValidSquares(index, 0, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down
                this.traceValidSquares(index, 0, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up
                break;
            case Piece.Queen_W:
            case Piece.Queen_B:
                this.traceValidSquares(index, 1, 0, isWhite, false, updatePins, x, y, attackOnly, inArray); // right
                this.traceValidSquares(index, -1, 0, isWhite, false, updatePins, x, y, attackOnly, inArray); // left
                this.traceValidSquares(index, 0, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down
                this.traceValidSquares(index, 0, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up
                this.traceValidSquares(index, 1, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up right
                this.traceValidSquares(index, -1, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up left
                this.traceValidSquares(index, 1, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down right
                this.traceValidSquares(index, -1, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down left
                break;
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                this.traceValidSquares(index, 1, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up right
                this.traceValidSquares(index, -1, -1, isWhite, false, updatePins, x, y, attackOnly, inArray); // up left
                this.traceValidSquares(index, 1, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down right
                this.traceValidSquares(index, -1, 1, isWhite, false, updatePins, x, y, attackOnly, inArray); // down left
                break;
            case Piece.Pawn_W:
            case Piece.Pawn_B:
            {
                let to = 0;
                const min = isWhite ? 1 : 7;
                const max = isWhite ? 6 : 12;
                const offset = isWhite ? -8 : 8;
                const startY = isWhite ? 6 : 1;
                const xMin = x >= 1;
                const xMax = x < xyMax;
                
                to = index + offset;     if (!attackOnly && (this.board[to] == Piece.Empty)) inArray.push(to);
                to = index + offset * 2; if (!attackOnly && y == startY && (this.board[to] == Piece.Empty && this.board[to - offset] == Piece.Empty)) inArray.push(to);
                to = index + offset + 1; if (xMax && (((attackOnly || this.board[to] != Piece.Empty) && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) || to == this.enPassantSquare)) inArray.push(to);
                to = index + offset - 1; if (xMin && (((attackOnly || this.board[to] != Piece.Empty) && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) || to == this.enPassantSquare)) inArray.push(to);

                break;
            }
            case Piece.King_W:
            case Piece.King_B:
            {
                let to = 0;
                const min = isWhite ? 1 : 7;
                const max = isWhite ? 6 : 12;
                const xMin = x >= 1;
                const xMax = x < xyMax;
                const yMin = y >= 1;
                const yMax = y < xyMax;

                to = index - 9; if (xMin && yMin && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index - 8; if (yMin &&         (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index - 7; if (xMax && yMin && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index - 1; if (xMin &&         (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index + 1; if (xMax &&         (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index + 7; if (xMin && yMax && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index + 8; if (yMax &&         (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                to = index + 9; if (xMax && yMax && (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max))) inArray.push(to);
                
                break;
            }
            case Piece.Knight_W:
            case Piece.Knight_B:
            {
                let to = 0;
                const min = isWhite ? 1 : 7;
                const max = isWhite ? 6 : 12;
                if (x >= 2) {
                    if (y >= 1) {
                        to = index - 10; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                    if (y <= xyMax - 1) {
                        to = index + 6;  if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                }
                if (x <= xyMax - 2) {
                    if (y <= xyMax - 1) {
                        to = index + 10; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                    if (y >= 1) {
                        to = index - 6;  if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                }
                if (y >= 2) {
                    if (x >= 1) {
                        to = index - 17; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                    if (x <= xyMax - 1) {
                        to = index - 15; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                }
                if (y <= xyMax - 2) {
                    if (x <= xyMax - 1) {
                        to = index + 17; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                    if (x >= 1) {
                        to = index + 15; if (this.board[to] == Piece.Empty || (this.board[to] >= min && this.board[to] <= max)) inArray.push(to);
                    }
                }
                
                break;
            }
            default:
                break;
        }
    }

    getAttackedSquares = (white: boolean, toIndex: number, updatePins: boolean = false) => {
        let attackedSquares: number[] = [];

        const startIndex = white ? 1 : 7;
        const endIndex = white ? 6 : 12;
        for (let i = startIndex; i <= endIndex; i++) {
            const length = this.pieceLocations[i].length;
            for (let j = 0; j < length; j++) {
                if (this.pieceLocations[i][j] == toIndex) // when searching for valid moves, instead of modifying the piece dictionaries, just ignore any piece that would have been captured
                    continue;
                this.getValidSquares(this.pieceLocations[i][j], i, true, updatePins, attackedSquares);
            }
        }

        return attackedSquares;
    }

    getValidCastleSquares = (attackedSquares: number[], inArray: EvalMove[]) => {
        if (this.whiteTurn) {
            let traced: number[] = [];
            this.traceValidSquares(60, 1, 0, false, true, false, 4, 7, false, traced);
            if ((this.castleStatus & CastleStatus.WhiteKing) && this.board[63] == Piece.Rook_W && traced.length == 2) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(61) && !attackedSquares.includes(62)) {
                    inArray.push({ from: 60, to: 62, data: 0, score: 0 });
                }
            }
            traced = [];
            this.traceValidSquares(60, -1, 0, false, true, false, 4, 7, false, traced);
            if ((this.castleStatus & CastleStatus.WhiteQueen) && this.board[56] == Piece.Rook_W && traced.length == 3) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(59) && !attackedSquares.includes(58)) {
                    inArray.push({ from: 60, to: 58, data: 0, score: 0 });
                }
            }
        } else {
            let traced: number[] = [];
            this.traceValidSquares(4, 1, 0, false, true, false, 4, 0, false, traced);
            if ((this.castleStatus & CastleStatus.BlackKing) && this.board[7] == Piece.Rook_B && traced.length == 2) {
                if (!attackedSquares.includes(4) && !attackedSquares.includes(5) && !attackedSquares.includes(6)) {
                    inArray.push({ from: 4, to: 6, data: 0, score: 0 });
                }
            }
            traced = [];
            this.traceValidSquares(4, -1, 0, false, true, false, 4, 0, false, traced);
            if ((this.castleStatus & CastleStatus.BlackQueen) && this.board[0] == Piece.Rook_B && traced.length == 3) {
                if (!attackedSquares.includes(4) && !attackedSquares.includes(3) && !attackedSquares.includes(2)) {
                    inArray.push({ from: 4, to: 2, data: 0, score: 0 });
                }
            }
        }
    }

    isInCheck = (white: boolean) => {
        const attacked = this.getAttackedSquares(white, -1);
        return this.isInCheckAttackedSquares(white, attacked);
    }

    isInCheckAttackedSquares = (white: boolean, attacked: number[]) => {
        return ((white && attacked.includes(this.pieceLocations[Piece.King_W][0])) || (!white && attacked.includes(this.pieceLocations[Piece.King_B][0])));
    }

    getAllValidMoves = (capturesOnly: boolean = false, baseAttackedSquares: number[] = []) => {
        let allValid: EvalMove[] = [];
        
        if (baseAttackedSquares.length == 0) {
            this.pinnedPieces = [];
            baseAttackedSquares = this.getAttackedSquares(this.whiteTurn, -1, true);
        }

        if (!capturesOnly)
            this.getValidCastleSquares(baseAttackedSquares, allValid);

        
        const inCheck = this.isInCheckAttackedSquares(this.whiteTurn, baseAttackedSquares);

        const startIndex = this.whiteTurn ? 7 : 1;
        const endIndex = this.whiteTurn ? 12 : 6;
        for (let i = startIndex; i <= endIndex; i++) {
            const length = this.pieceLocations[i].length;
            for (let j = 0; j < length; j++) {
                const location = this.pieceLocations[i][j];

                let valid: number[] = [];
                this.getValidSquares(location, i, capturesOnly, false, valid);

                const isPinned = this.pinnedPieces.includes(location);
                const validLength = valid.length;
                for (let k = 0; k < validLength; k++) {
                    if (capturesOnly && this.board[valid[k]] == Piece.Empty)
                        continue;

                    const isEnPassant = valid[k] == this.enPassantSquare;
                    if (isEnPassant || inCheck || isPinned || i == Piece.King_W || i == Piece.King_B) { // more optimizations here?
                    //if (false) {
                        const pieceBackup = this.board[valid[k]];
                        const backup2 = this.board[location];
                        this.board[valid[k]] = i;
                        this.board[location] = Piece.Empty;

                        if (isEnPassant) {
                            if (i == Piece.Pawn_W) {
                                this.board[valid[k] + 8] = Piece.Empty;
                            } else if (i == Piece.Pawn_B) {
                                this.board[valid[k] - 8] = Piece.Empty;
                            }
                        }

                        const attacked: number[] = this.getAttackedSquares(this.whiteTurn, valid[k]);
                        this.board[valid[k]] = pieceBackup;
                        this.board[location] = backup2;
                        if (isEnPassant) {
                            if (i == Piece.Pawn_W) {
                                this.board[valid[k] + 8] = Piece.Pawn_B;
                            } else if (i == Piece.Pawn_B) {
                                this.board[valid[k] - 8] = Piece.Pawn_W;
                            }
                        }

                        if (i == Piece.King_W || i == Piece.King_B) {
                            if (attacked.includes(valid[k]))
                                continue;
                        }
                        else if (this.isInCheckAttackedSquares(this.whiteTurn, attacked))
                            continue;
                    }

                    // add more moves to account for promoting to various pieces
                    const y = (valid[k] / this.boardSize) << 0;
                    if (i == Piece.Pawn_W && y == 0) {
                        allValid.push({ from: location, to: valid[k], data: Piece.Queen_W, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Rook_W, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Bishop_W, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Knight_W, score: 0 });
                    } else if (i == Piece.Pawn_B && y == 7) {
                        allValid.push({ from: location, to: valid[k], data: Piece.Queen_B, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Rook_B, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Bishop_B, score: 0 });
                        allValid.push({ from: location, to: valid[k], data: Piece.Knight_B, score: 0 });
                    } else {
                        allValid.push({ from: location, to: valid[k], data: 0, score: 0 });
                    }
                }
            }
        }

        return allValid;
    }

    generateMoveString = (fromIndex: number, toIndex: number) => {
        if (this.castledThisTurn) {
            if (this.whiteTurn) { // todo: O-O-O

            }
            return "O-O";
        }

        let pieceName = getPieceNameShort(this.board[toIndex]).toUpperCase(); // for opening comparison
        if (pieceName == "" && this.pieceCapturedThisTurn) { // pawn capture so get the name of the file it came from
            pieceName = indexToNotation(fromIndex)[0];
        }
        const newLocation = indexToNotation(toIndex);

        return `${pieceName}${this.pieceCapturedThisTurn ? 'x' : ''}${newLocation}${this.inCheck ? '+' : ''}`;
    }

    finishTurn = () => {
        this.whiteTurn = !this.whiteTurn;
        this.historicalBoards.push(this.createHistoricalBoard());
        this.boardHash = this.hashBoard();
        this.boardDelta = [];
        this.allValidMoves = this.getAllValidMoves();
        this.inCheck = this.isInCheck(this.whiteTurn);
        this.savedEvaluations = {};

        this.moveCount++;
        this.moveRepCount++;
    }

    removePiece = (piece: number, index: number) => {
        const foundIndex = this.pieceLocations[piece].indexOf(index);
        if (foundIndex != -1) {
            this.pieceLocations[piece][foundIndex] = this.pieceLocations[piece][this.pieceLocations[piece].length - 1];
            this.pieceLocations[piece].pop();
        }
    }

    movePiece = (piece: number, index: number, newLocation: number) => {
        const foundIndex = this.pieceLocations[piece].indexOf(index);
        if (foundIndex != -1) {
            this.pieceLocations[piece][foundIndex] = newLocation;
        }
    }

    forceMakeMove = (fromIndex: number, move: MoveInfo, finishTurn: boolean) => {
        const toIndex = move.index;
        const movingPiece = this.board[fromIndex];
        const capturedPiece = this.board[toIndex];

        this.boardDelta.push({ index: toIndex, piece: capturedPiece, target: -1 });
        this.boardDelta.push({ index: fromIndex, piece: movingPiece, target: toIndex });
        this.board[toIndex] = this.board[fromIndex];
        this.board[fromIndex] = Piece.Empty;

        // promotion check
        let promoted = false;
        const y = (toIndex / this.boardSize) << 0;
        if (this.board[toIndex] == Piece.Pawn_W && y == 0) {
            this.board[toIndex] = move.data;
            this.removePiece(Piece.Pawn_W, fromIndex);
            this.pieceLocations[move.data].push(toIndex); // add new piece entry
            this.boardDelta.push({ index: -1, piece: move.data, target: toIndex }); // add promotion delta
            promoted = true;
        }
        else if (this.board[toIndex] == Piece.Pawn_B && y == 7) {
            this.board[toIndex] = move.data;
            this.removePiece(Piece.Pawn_B, fromIndex);
            this.pieceLocations[move.data].push(toIndex); // add new piece entry
            this.boardDelta.push({ index: -1, piece: move.data, target: toIndex }); // add promotion delta
            promoted = true;
        }

        // en passant check
        if (toIndex == this.enPassantSquare) { // capturing en passant, so remove the pawn and add a delta
            if (movingPiece == Piece.Pawn_W) {
                this.boardDelta.push({ index: toIndex + 8, piece: Piece.Pawn_B, target: -1 });
                this.board[toIndex + 8] = Piece.Empty;
                this.removePiece(Piece.Pawn_B, toIndex + 8);
            } else if (movingPiece == Piece.Pawn_B) {
                this.boardDelta.push({ index: toIndex - 8, piece: Piece.Pawn_W, target: -1 });
                this.board[toIndex - 8] = Piece.Empty;
                this.removePiece(Piece.Pawn_W, toIndex - 8);
            }
        }

        if (movingPiece == Piece.Pawn_W && fromIndex - toIndex == 16) { // moving two spaces up
            this.enPassantSquare = fromIndex - 8;
        }
        else if (movingPiece == Piece.Pawn_B && toIndex - fromIndex == 16) { // moving two spaces down
            this.enPassantSquare = fromIndex + 8;
        }
        else {
            this.enPassantSquare = -1;
        }

        // update moved piece position unless promoted since that is already handled
        if (!promoted) {
            this.movePiece(movingPiece, fromIndex, toIndex);
        }

        // remove captured piece
        if (capturedPiece != Piece.Empty) {
            this.removePiece(capturedPiece, toIndex);
        }

        if (finishTurn) {
            this.finishTurn();

            const moveString = this.generateMoveString(fromIndex, toIndex);
            this.moveList.push(moveString);

            // update board repetition history
            if (movingPiece == Piece.Pawn_W || movingPiece == Piece.Pawn_B || capturedPiece != Piece.Empty) { // repetitions not possible with these moves
                this.repetitionHistory = [];
                this.moveRepCount = 0;
            } else {
                this.repetitionHistory.push(this.boardHash);
            }
        }
    }

    unmakeMove = (deltas: BoardDelta[], startingEnPassant: number) => {
        this.whiteTurn = !this.whiteTurn;

        for (let i = 0; i < deltas.length; i++) {
            if (deltas[i].piece != Piece.Empty) { // ignore any empty piece entries
                if (deltas[i].index == -1) { // if the original index is -1, it means the piece was created from promotion, so remove the piece
                    this.removePiece(deltas[i].piece, deltas[i].target);
                } else if (this.board[deltas[i].index] != Piece.Empty || (deltas[i].piece == Piece.Pawn_B && deltas[i].index - 8 == startingEnPassant) || (deltas[i].piece == Piece.Pawn_W && deltas[i].index + 8 == startingEnPassant)) { // was captured so add the piece back to register
                    this.pieceLocations[deltas[i].piece].push(deltas[i].index);
                } else if (deltas[i].target != -1) { // otherwise just move it back
                    const foundIndex = this.pieceLocations[deltas[i].piece].indexOf(deltas[i].target);
                    if (foundIndex != -1)
                        this.pieceLocations[deltas[i].piece][foundIndex] = deltas[i].index; // replace with new location
                    else
                        this.pieceLocations[deltas[i].piece].push(deltas[i].index);
                }
            }

            if (deltas[i].index != -1)
                this.board[deltas[i].index] = deltas[i].piece;
        }
    }

    updateCastleStatus = (fromIndex: number, toIndex: number) => {
        const movingPiece = this.board[fromIndex];
        let castled = false;

        if (movingPiece == Piece.King_W) {
            if ((this.castleStatus & CastleStatus.WhiteKing) && toIndex == 62) {
                this.boardDelta.push({ index: 63, piece: this.board[63], target: 61 });
                this.boardDelta.push({ index: 61, piece: this.board[61], target: -1 });
                this.movePiece(Piece.Rook_W, 63, 61); // replace with new location
                this.board[63] = Piece.Empty;
                this.board[61] = Piece.Rook_W;
                castled = true;
            } else if ((this.castleStatus & CastleStatus.WhiteQueen) && toIndex == 58) {
                this.boardDelta.push({ index: 56, piece: this.board[56], target: 59 });
                this.boardDelta.push({ index: 59, piece: this.board[59], target: -1 });
                this.movePiece(Piece.Rook_W, 56, 59); // replace with new location
                this.board[56] = Piece.Empty;
                this.board[59] = Piece.Rook_W;
                castled = true;
            }

            this.castleStatus &= ~CastleStatus.WhiteKing;
            this.castleStatus &= ~CastleStatus.WhiteQueen;
        }
        else if (movingPiece == Piece.King_B) {
            if ((this.castleStatus & CastleStatus.BlackKing) && toIndex == 6) {
                this.boardDelta.push({ index: 7, piece: this.board[7], target: 5 });
                this.boardDelta.push({ index: 5, piece: this.board[5], target: -1 });
                this.movePiece(Piece.Rook_B, 7, 5); // replace with new location
                this.board[7] = Piece.Empty;
                this.board[5] = Piece.Rook_B;
                castled = true;
            } else if ((this.castleStatus & CastleStatus.BlackQueen) && toIndex == 2) {
                this.boardDelta.push({ index: 0, piece: this.board[0], target: 3 });
                this.boardDelta.push({ index: 3, piece: this.board[3], target: -1 });
                this.movePiece(Piece.Rook_B, 0, 3); // replace with new location
                this.board[0] = Piece.Empty;
                this.board[3] = Piece.Rook_B;
                castled = true;
            }

            this.castleStatus &= ~CastleStatus.BlackKing;
            this.castleStatus &= ~CastleStatus.BlackQueen;
        } // add castling info deltas
        else if (movingPiece == Piece.Rook_W && fromIndex == 56) {
            this.castleStatus &= ~CastleStatus.WhiteQueen;
        }
        else if (movingPiece == Piece.Rook_W && fromIndex == 63) {
            this.castleStatus &= ~CastleStatus.WhiteKing;
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 0) {
            this.castleStatus &= ~CastleStatus.BlackQueen;
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 7) {
            this.castleStatus &= ~CastleStatus.BlackKing;
        }

        return castled;
    }    

    updateHash = (delta: BoardDelta[], hash: bigint, oldEnPassant: number, oldCastleStatus: number) => {
        let newHash = hash;

        // positions
        for (let i = 0; i < delta.length; i++) {
            if (delta[i].index != -1) { // -1 entries are usually for tracking, so don't worry about them when updating the hash
                const pos = delta[i].index;
                const piece = delta[i].piece - 1;
                const newPiece = this.board[pos] - 1;
                if (piece >= 0)
                    newHash = newHash ^ this.zobristHashTable[pos][piece];
                if (newPiece >= 0)
                    newHash = newHash ^ this.zobristHashTable[pos][newPiece];
            }
        }

        // castling
        if ((oldCastleStatus & CastleStatus.WhiteKing) != (this.castleStatus & CastleStatus.WhiteKing)) {
            hash = hash ^ this.zobristHashTable[64][0]; // flip
        }
        if ((oldCastleStatus & CastleStatus.WhiteQueen) != (this.castleStatus & CastleStatus.WhiteQueen)) {
            hash = hash ^ this.zobristHashTable[64][1]; // flip
        }
        if ((oldCastleStatus & CastleStatus.BlackKing) != (this.castleStatus & CastleStatus.BlackKing)) {
            hash = hash ^ this.zobristHashTable[64][2]; // flip
        }
        if ((oldCastleStatus & CastleStatus.BlackQueen) != (this.castleStatus & CastleStatus.BlackQueen)) {
            hash = hash ^ this.zobristHashTable[64][3]; // flip
        }

        // turn
        newHash = newHash ^ this.zobristHashTable[65][0];

        // en passant
        if (oldEnPassant != this.enPassantSquare) {
            if (oldEnPassant != -1)
                newHash = newHash ^ this.zobristHashTable[66][oldEnPassant];
            if (this.enPassantSquare != -1)
                newHash = newHash ^ this.zobristHashTable[66][this.enPassantSquare];
        }

        return newHash;
    }

    getPieceCount = () => {
        let pieceCount = 0;
        for (let i = 1; i < this.pieceLocations.length; i++) {
            pieceCount += this.pieceLocations[i].length;
        }
        return pieceCount;
    }

    checkForDraw = () => {
        if (this.moveRepCount >= 50) {
            //console.log("Draw by 50 rep")
            return true;
        }

        if (!this.whiteTurn) // white's last move cannot be a draw
            return false;

        if (this.getPieceCount() == 2) // only the kings are left
            return true;

        let count = 0;
        for (let i = 0; i < this.repetitionHistory.length; i++) {
            if (this.repetitionHistory[i] == this.boardHash)
                count++;
            if (count == 3) {
                //console.log("Draw by 3 rep")
                return true;
            }
        }

        return false;
    }

    readSquareTableValue = (index: number, table: number[], white: boolean) => {
        if (!white)
            index = 63 - index;
        return table[index];
    }

    evaluateSquareTable = (piece: number, table: number[], white: boolean) => {
        let value = 0;
        if (piece == Piece.Empty)
            return 0;

        const positions = this.pieceLocations[piece];
        const length = positions.length;
        for (let i = 0; i < length; i++) {
            value += this.readSquareTableValue(positions[i], table, white);
        }

        return value;
    }

    evaluateSquareTables = (white: boolean, endgameWeight: number) => {
        let value = 0;

        // ugly
        if (white) {
            value += this.evaluateSquareTable(Piece.Pawn_W, pawnSquareTable, white);
            value += this.evaluateSquareTable(Piece.Rook_W, rookSquareTable, white);
            value += this.evaluateSquareTable(Piece.Knight_W, knightSquareTable, white);
            value += this.evaluateSquareTable(Piece.Bishop_W, bishopSquareTable, white);
            value += this.evaluateSquareTable(Piece.Queen_W, queenSquareTable, white);
            let kingMiddlegameValue = this.evaluateSquareTable(Piece.King_W, kingMiddleGameSquareTable, white);
            value += (kingMiddlegameValue * (1 - endgameWeight)) << 0;
        } else {
            value += this.evaluateSquareTable(Piece.Pawn_B, pawnSquareTable, white);
            value += this.evaluateSquareTable(Piece.Rook_B, rookSquareTable, white);
            value += this.evaluateSquareTable(Piece.Knight_B, knightSquareTable, white);
            value += this.evaluateSquareTable(Piece.Bishop_B, bishopSquareTable, white);
            value += this.evaluateSquareTable(Piece.Queen_B, queenSquareTable, white);
            let kingMiddlegameValue = this.evaluateSquareTable(Piece.King_B, kingMiddleGameSquareTable, white);
            value += (kingMiddlegameValue * (1 - endgameWeight)) << 0;
        }

        return value;
    }

    evaluateEndgamePosition = (endgameWeight: number, opponentKingX: number, opponentKingY: number, distance: number) => {
        let score = 0;

        // try to push the enemy king into the corner
        const distToCenter = Math.abs(opponentKingX - 4) + Math.abs(opponentKingY - 4);
        score += distToCenter;

        // try and move kings together
        score += 14 - distance;

        return (score * 20 * endgameWeight) << 0;
    }

    evaluatePawnStructure = (white: boolean) => {
        let score = 0;
        let pawnList = this.pieceLocations[white ? Piece.Pawn_W : Piece.Pawn_B];
        const length = pawnList.length;
        for (let i = 0; i < length; i++) {
            if ((white && this.board[pawnList[i] + 8] == Piece.Pawn_W) || (!white && this.board[pawnList[i] - 8] == Piece.Pawn_B)) // check for doubled pawns
                score -= 2;
            const protectedLeft = (white && this.board[pawnList[i] + 7] == Piece.Pawn_W) || (!white && this.board[pawnList[i] - 7] != Piece.Pawn_B);
            const protectedRight = (white && this.board[pawnList[i] + 9] == Piece.Pawn_W) || (!white && this.board[pawnList[i] - 9] != Piece.Pawn_B);
            if (!protectedLeft && !protectedRight) // isolate
                score -= 2;
            else if (protectedRight || protectedLeft)
                score += 2;
        }
        return score * 10;
    }

    evaluate = () => {
        const materialWeight = 1;
        const developmentWeight = 1;

        const whiteMaterial = this.countMaterial(true);
        const blackMaterial = this.countMaterial(false);
        const whiteMaterialWithoutPawns = whiteMaterial - (this.pieceLocations[Piece.Pawn_W].length * this.getPieceValue(Piece.Pawn_W)); 
        const blackMaterialWithoutPawns = blackMaterial - (this.pieceLocations[Piece.Pawn_B].length * this.getPieceValue(Piece.Pawn_B)); 

        const whiteEndgameWeight = 1 - Math.min(1, whiteMaterialWithoutPawns / this.endgameMaterialThreshold);
        const blackEndgameWeight = 1 - Math.min(1, blackMaterialWithoutPawns / this.endgameMaterialThreshold);

        let whiteEval = whiteMaterial * materialWeight;
        let blackEval = blackMaterial * materialWeight;
        
        whiteEval += (this.evaluateSquareTables(true, whiteEndgameWeight) * developmentWeight) << 0;
        blackEval += (this.evaluateSquareTables(false, blackEndgameWeight) * developmentWeight) << 0;

        const whiteX = this.pieceLocations[Piece.King_W][0] % this.boardSize;
        const whiteY = (this.pieceLocations[Piece.King_W][0] / this.boardSize) << 0;
        const blackX = this.pieceLocations[Piece.King_B][0] % this.boardSize;
        const blackY = (this.pieceLocations[Piece.King_B][0] / this.boardSize) << 0;
        const distanceBetween = Math.abs(whiteX - blackX) + Math.abs(whiteY - blackY);
        whiteEval += this.evaluateEndgamePosition(whiteEndgameWeight, blackX, blackY, distanceBetween);
        blackEval += this.evaluateEndgamePosition(blackEndgameWeight, whiteX, whiteY, distanceBetween);

        //whiteEval += this.evaluatePawnStructure(true);
        //blackEval += this.evaluatePawnStructure(false);

        let evaluation = whiteEval - blackEval;
        if (!this.whiteTurn)
            evaluation *= -1;

        return evaluation;
    }

    getPieceValue = (piece: number) => {
        switch (piece) {
            case Piece.Pawn_W:
            case Piece.Pawn_B:
                return Value.Pawn;
            case Piece.Knight_W:
            case Piece.Knight_B:
                return Value.Knight;
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                return Value.Bishop;
            case Piece.Rook_W:
            case Piece.Rook_B:
                return Value.Rook;
            case Piece.Queen_W:
            case Piece.Queen_B:
                return Value.Queen;
            default:
                return 0;
        }
    }

    getPieceTable = (piece: number) => {
        switch (piece) {
            case Piece.Pawn_W:
            case Piece.Pawn_B:
                return pawnSquareTable;
            case Piece.Knight_W:
            case Piece.Knight_B:
                return knightSquareTable;
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                return bishopSquareTable;
            case Piece.Rook_W:
            case Piece.Rook_B:
                return rookSquareTable;
            case Piece.Queen_W:
            case Piece.Queen_B:
                return queenSquareTable;
            case Piece.King_W:
            case Piece.King_B:
                return kingMiddleGameSquareTable;
            default:
                return emptySquareTable;
        }
    }

    countMaterial = (white: boolean) => {
        let value: number = 0;

        const startIndex = white ? 8 : 2;
        const endIndex = white ? 12 : 6;
        for (let i = startIndex; i <= endIndex; i++) {
            value += this.getPieceValue(i) * this.pieceLocations[i].length;
        }

        return value;
    }

    predictAndOrderMoves = (moves: EvalMove[], attackedSquares: number[], storedMove: EvalMove | undefined) => {
        const movesLength = moves.length;

        for (let i = 0; i < movesLength; i++) {
            let score = 0;
            const movingPiece = this.board[moves[i].from];
            const capturingPiece = this.board[moves[i].to];
            const promoting = moves[i].data;

            if (storedMove != undefined && storedMove.to == moves[i].to && storedMove.from == moves[i].from && storedMove.data == moves[i].data) {
                moves[i].score = 10000;
                continue;
            }

            if (capturingPiece != Piece.Empty) {
                score += 10 * this.getPieceValue(capturingPiece) - this.getPieceValue(movingPiece); // apply a higher score for lower val piece capturing higher val
            }

            // deprioritize moving into attacked squares
            if (attackedSquares.includes(moves[i].to)) {
                score -= this.getPieceValue(movingPiece);
            }

            // score promotion moves
            if (movingPiece == Piece.Pawn_W || movingPiece == Piece.Pawn_B) {
                score += this.getPieceValue(promoting);
            }

            score += this.readSquareTableValue(moves[i].to, this.getPieceTable(movingPiece), this.whiteTurn); 

            moves[i].score = score;

            // sorting
            let index = i;
            let currentElem = moves[index];
            while (index > 0 && (currentElem.score > moves[index - 1].score || (currentElem.score == moves[index - 1].score && currentElem.from > moves[index - 1].from))) {
                moves[index] = moves[index - 1];
                index -= 1;
            }
            moves[index] = currentElem;
        }

        // moves.sort((a, b) => {
        //     return b.score - a.score;
        // });
    }

    findBestMoveWithIterativeDeepening = () => {
        this.searchStartTime = Date.now();
        const maxDepth = 30;
        let lastCompletedDepth = 0;

        for (let i = 3; i <= maxDepth; i++) {
            const iterationStartTime = self.performance.now();
            this.findBestMove(true, i, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
            const iterationEndTime = self.performance.now();

            if (Date.now() - this.searchStartTime >= this.searchMaxTime) // search aborted so dont update move
                break;

            //console.log(`Finished iteration ${i} in ${(iterationEndTime - iterationStartTime) << 0}ms`);

            lastCompletedDepth = i;
            this.movesFoundThisTurn = this.movesFoundThisIteration;
            this.movesFoundThisIteration = [];
            this.evalBestMove = this.evalBestMoveThisIteration;
            ctx.postMessage({ command: EvalCommands.ReceiveCurrentEval, eval: this.whiteTurn ? this.evalBestMove.score : -1 * this.evalBestMove.score });

            if (this.evalBestMoveThisIteration.score > 99999999) // mate
                break;
        }
        
        this.depthSearchedThisTurn = lastCompletedDepth;
    }

    // lower bound: alpha, upper bound: beta
    findBestMove = (canCancel: boolean, depth: number, offset: number, alpha: number, beta: number) => {
        if (canCancel && Date.now() - this.searchStartTime >= this.searchMaxTime) // abort search
            return 0;

        if (depth <= 0) {
            //return this.evaluate();
            return this.quiescenceSearch(alpha, beta);
        }

        if (offset > 0) {
            // detect any repetition and assume a draw is coming (return a 0 draw score)
            if (this.repetitionHistory.includes(this.boardHash))
                return 0;
        }

        // modify the values to skip this position if a mating sequence has already been found and is shorter
        alpha = Math.max(alpha, Number.MIN_SAFE_INTEGER + offset);
        beta = Math.min(beta, Number.MAX_SAFE_INTEGER - offset);
        if (alpha >= beta) {
            return alpha;
        }

        const hashString = this.boardHash.toString();
        let storedMove: EvalMove | undefined = undefined;
        if (hashString in this.savedEvaluations) {
            const savedEval = this.savedEvaluations[hashString];
            storedMove = savedEval.bestMove;
            let finalScore = savedEval.eval;
            let shouldReturn = false;
            if (savedEval.depth >= depth) {
                if (savedEval.type == SavedEvalTypes.Exact) // exact eval was saved so just return it
                    shouldReturn = true;
                else if (savedEval.type == SavedEvalTypes.Alpha && finalScore <= alpha) // if we are storing the lower bound, only search if it is greater than the current lower bound
                    shouldReturn = true;
                else if (savedEval.type == SavedEvalTypes.Beta && finalScore >= beta) // if we are storing the upper bound, only search if it is less than the current upper bound
                    shouldReturn = true;
            }
            if (shouldReturn) {
                if (offset == 0) {
                    this.evalBestMoveThisIteration = this.savedEvaluations[hashString].bestMove;
                    this.evalBestMoveThisIteration.score = this.savedEvaluations[hashString].eval;
                }
                return finalScore;
            }
        }

        this.pinnedPieces = [];
        const attackedSquares = this.getAttackedSquares(this.whiteTurn, -1, true);
        const validMoves = this.getAllValidMoves(false, attackedSquares);
        const inCheck = this.isInCheckAttackedSquares(this.whiteTurn, attackedSquares);
        
        if (validMoves.length == 0) { // either checkmate or stalemate
            if (inCheck)
                return Number.MIN_SAFE_INTEGER + offset; // checkmate, worst possible move
            else
                return 0; // stalemate, draw
        }
        this.predictAndOrderMoves(validMoves, attackedSquares, storedMove);

        const startingHash = this.boardHash;
        const oldEnPassant = this.enPassantSquare;
        const oldCastleStatus = this.castleStatus;
        let bestMoveForThisPosition: EvalMove = { from: -1, to: -1, data: 0, score: 0 };
        let savingType = SavedEvalTypes.Alpha;
        const length = validMoves.length;
        for (let i = 0; i < length; i++) {
            // make the move (todo: move to function)
            this.updateCastleStatus(validMoves[i].from, validMoves[i].to);
            this.forceMakeMove(validMoves[i].from, { index: validMoves[i].to, data: validMoves[i].data }, false);
            const deltas = this.boardDelta;
            this.boardDelta = [];
            this.whiteTurn = !this.whiteTurn;
            this.boardHash = this.updateHash(deltas, startingHash, oldEnPassant, oldCastleStatus);

            // calculate evaluation (one player's upper bound is the other's lower bound)
            // let evaluation: number = -1 * this.findBestMove(canCancel, depth - 1, offset + 1, -alpha - 1, -alpha);
            // if (evaluation > alpha && evaluation < beta)
            //     evaluation = -1 * this.findBestMove(canCancel, depth - 1, offset + 1, -beta, -alpha);

            let evaluation: number = -1 * this.findBestMove(canCancel, depth - 1, offset + 1, -beta, -alpha);

            // unmake the move
            this.unmakeMove(deltas, oldEnPassant);
            this.boardHash = startingHash;
            this.enPassantSquare = oldEnPassant;
            this.castleStatus = oldCastleStatus;

            // calc alpha & beta
            if (evaluation >= beta) {
                this.savedEvaluations[hashString] = { totalMoves: 0, depth: depth, bestMove: bestMoveForThisPosition, type: SavedEvalTypes.Beta, eval: beta };
                return beta;
            }
            if (evaluation > alpha) { // best move found
                bestMoveForThisPosition = validMoves[i];
                alpha = evaluation;
                savingType = SavedEvalTypes.Exact;

                if (offset == 0) {
                    this.evalBestMoveThisIteration = bestMoveForThisPosition;
                    this.evalBestMoveThisIteration.score = evaluation;
                    this.movesFoundThisIteration.push({
                        move: this.evalBestMoveThisIteration,
                        piece: this.board[bestMoveForThisPosition.from],
                        capture: this.board[bestMoveForThisPosition.to] != Piece.Empty,
                    });
                }
            }
        }

        this.savedEvaluations[hashString] = { totalMoves: 0, depth: depth, bestMove: bestMoveForThisPosition, type: savingType, eval: alpha };
        return alpha;
    }

    // search until the position is 'quiet' (no captures remaining)
    quiescenceSearch(alpha: number, beta: number) {
        let evaluation: number = this.evaluate(); // evaluate first to prevent forcing a bad capture when there may have been better non capture moves
        if (evaluation >= beta)
            return beta;
        if (evaluation > alpha)
            alpha = evaluation;

        this.pinnedPieces = [];
        const attackedSquares = this.getAttackedSquares(this.whiteTurn, -1, true);
        const validMoves = this.getAllValidMoves(true, attackedSquares);
        this.predictAndOrderMoves(validMoves, attackedSquares, undefined);

        const oldEnPassant = this.enPassantSquare;
        const length = validMoves.length;
        for (let i = 0; i < length; i++) {
            // make the move (todo: move to function)
            // dont update hash because it isn't relevant here
            this.forceMakeMove(validMoves[i].from, { index: validMoves[i].to, data: validMoves[i].data }, false);
            const deltas = this.boardDelta;
            this.boardDelta = [];
            this.whiteTurn = !this.whiteTurn;

            // evaluation = -1 * this.quiescenceSearch(-alpha - 1, -alpha);
            // if (evaluation > alpha && evaluation < beta)
            //     evaluation = -1 * this.quiescenceSearch(-beta, -alpha);

            evaluation = -1 * this.quiescenceSearch(-beta, -alpha);

            // unmake the move
            this.unmakeMove(deltas, oldEnPassant);
            this.enPassantSquare = oldEnPassant;

            if (evaluation >= beta)
                return beta;
            if (evaluation > alpha)
                alpha = evaluation;
        }

        return alpha;
    }

    calculateAllPossibleMoves = (depth: number) => {
        if (depth <= 0)
            return 1;

        const hashString = this.boardHash.toString();
        if (hashString in this.savedEvaluations && this.savedEvaluations[hashString].depth == depth)
            return this.savedEvaluations[hashString].totalMoves;

        const validMoves = this.getAllValidMoves();
        let totalMoves = 0;

        const startingHash = this.boardHash;
        const oldEnPassant = this.enPassantSquare;
        const oldCastleStatus = this.castleStatus;
        const validLength = validMoves.length;
        for (let i = 0; i < validLength; i++) { 
            this.updateCastleStatus(validMoves[i].from, validMoves[i].to);
            this.forceMakeMove(validMoves[i].from, { index: validMoves[i].to, data: validMoves[i].data }, false);
            const deltas = this.boardDelta;
            this.boardDelta = [];
            this.whiteTurn = !this.whiteTurn;
            this.boardHash = this.updateHash(deltas, startingHash, oldEnPassant, oldCastleStatus);

            totalMoves += this.calculateAllPossibleMoves(depth - 1);

            this.unmakeMove(deltas, oldEnPassant);
            this.boardHash = startingHash;
            this.enPassantSquare = oldEnPassant;
            this.castleStatus = oldCastleStatus;
        }

        this.savedEvaluations[hashString] = { totalMoves: totalMoves, depth: depth, eval: 0, type: SavedEvalTypes.Exact, bestMove: { from: -1, to: -1, data: 0, score: 0 } };
        return totalMoves;
    }

    randomBotMove = () => {
        if (this.historicalIndex != 0)
            return;

        const moveIndex = (Math.random() * this.allValidMoves.length) << 0;
        const move = this.allValidMoves[moveIndex];

        this.updateCastleStatus(move.from, move.to);
        this.forceMakeMove(move.from, { index: move.to, data: move.data }, true);
    }

    findPieceInFile = (piece: number, file: string) => {
        for (let i = 0; i < this.pieceLocations[piece].length; i++) {
            const index = this.pieceLocations[piece][i];
            const foundFile = indexToNotation(index)[0];
            if (foundFile == file)
                return index;
        }
        return -1;
    }

    bookMove = () => { // a bit messy, cleanup ?
        try {
            if (this.moveCount == 0) { // if its move one, play a random opening
                const index = Math.floor(Math.random() * openings.length);
                const opening = openings[index];
                const move = opening.moves[0];
                move.replace(/\W/g, '');
                const file = move[move.length - 2];
                const rank = parseInt(move[move.length - 1]);
                let from = -1;
                let to = notationToIndex(rank, file);

                if (move.length == 2) { // pawn move
                    from = this.findPieceInFile(Piece.Pawn_W, file); // always white since move zero
                } else { // otherwise find the piece with that move as valid
                    const pieceName = move[0];
                    const piece = fenToPieceDict[this.whiteTurn ? pieceName.toUpperCase() : pieceName.toLowerCase()];
                    for (let i = 0; i < this.allValidMoves.length; i++) {
                        if (this.board[this.allValidMoves[i].from] == piece && this.allValidMoves[i].to == to) {
                            from = this.allValidMoves[i].from;
                            break;
                        }
                    }
                }

                if (from == -1 || to == -1)
                    return false;

                this.currentOpening = opening.name;
                this.depthSearchedThisTurn = -1;
                this.updateCastleStatus(from, to);
                this.pieceCapturedThisTurn = this.board[to] != Piece.Empty;
                this.forceMakeMove(from, { index: to, data: Piece.Empty }, true);

                return true;
            } else { // otherwise we must interpret the position and decide if this opening exists
                let validOpenings: number[] = [];
                for (let i = 0; i < openings.length; i++) {
                    if (openings[i].moves.length > this.moveList.length)
                        if (this.moveList.every((e, j) => e == openings[i].moves[j]))
                            validOpenings.push(i);
                }

                if (validOpenings.length == 0) {
                    return false;
                }

                // then pick a random opening from the valid ones and make the next move
                const index = Math.floor(Math.random() * validOpenings.length);
                const opening = openings[validOpenings[index]];
                const move = opening.moves[this.moveList.length];
                move.replace(/\W/g, '');
                const file = move[move.length - 2];
                const rank = parseInt(move[move.length - 1]);
                let from = -1;
                let to = notationToIndex(rank, file);

                if (move.length == 2) { // pawn move
                    from = this.findPieceInFile(this.whiteTurn ? Piece.Pawn_W : Piece.Pawn_B, file);
                } else { // otherwise find the piece with that move as valid
                    const pieceName = move[0];
                    let piece = fenToPieceDict[this.whiteTurn ? pieceName.toUpperCase() : pieceName.toLowerCase()];
                    for (let i = 0; i < this.allValidMoves.length; i++) {
                        if (this.board[this.allValidMoves[i].from] == piece && this.allValidMoves[i].to == to) {
                            from = this.allValidMoves[i].from;
                            break;
                        }
                    }

                    // if not found, its likely a pawn capture move
                    piece = this.whiteTurn ? Piece.Pawn_W : Piece.Pawn_B;
                    if (from == -1 ){
                        for (let i = 0; i < this.allValidMoves.length; i++) {
                            if (this.board[this.allValidMoves[i].from] == piece && this.allValidMoves[i].to == to) {
                                from = this.allValidMoves[i].from;
                                break;
                            }
                        }
                    }
                }

                if (from == -1 || to == -1)
                    return false;

                this.currentOpening = opening.name;
                this.depthSearchedThisTurn = -1;
                this.castledThisTurn = this.updateCastleStatus(from, to);
                this.pieceCapturedThisTurn = this.board[to] != Piece.Empty;
                this.forceMakeMove(from, { index: to, data: Piece.Empty }, true);

                return true;
            }
        } catch (e) { // if something goes wrong, just cancel
            this.useHistoricalBoard(this.historicalBoards[this.historicalBoards.length - 1]);
            return false;
        }
    }

    evalBotMove = (depth: number) => {
        if (this.historicalIndex != 0)
            return;

        if (this.checkForDraw())
            return;

        const startTime = self.performance.now();
        const lastMove = this.evalBestMove;

        this.movesFoundThisIteration = [];
        this.movesFoundThisTurn = [];
        this.evalBestMove = {} as EvalMove;
        
        this.findBestMove(false, depth, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        if (lastMove.to == this.evalBestMoveThisIteration.to && lastMove.from == this.evalBestMoveThisIteration.from) {
            console.log("Attempting to make the same move: " + lastMove.toString());
            return;
        } else {
            this.evalBestMove = this.evalBestMoveThisIteration;
        }

        this.movesFoundThisTurn = this.movesFoundThisIteration;
        this.depthSearchedThisTurn = depth;
        this.castledThisTurn = this.updateCastleStatus(this.evalBestMove.from, this.evalBestMove.to);
        this.pieceCapturedThisTurn = this.board[this.evalBestMove.to] != Piece.Empty;
        this.forceMakeMove(this.evalBestMove.from, { index: this.evalBestMove.to, data: this.evalBestMove.data }, true);

        const endTime = self.performance.now();
        this.timeTakenLastTurn = endTime - startTime; // ms
    }

    evalBotMoveIterative = () => {
        if (this.historicalIndex != 0)
            return;

        if (this.checkForDraw())
            return;

        const startTime = self.performance.now();
        const lastMove = this.evalBestMove;

        this.movesFoundThisIteration = [];
        this.movesFoundThisTurn = [];
        this.evalBestMove = {} as EvalMove;

        engine.findBestMoveWithIterativeDeepening();
        if (lastMove.to == this.evalBestMove.to && lastMove.from == this.evalBestMove.from) {
            console.log("Attempting to make the same move: " + lastMove.toString());
            return;
        }

        this.castledThisTurn = this.updateCastleStatus(this.evalBestMove.from, this.evalBestMove.to);
        this.pieceCapturedThisTurn = this.board[this.evalBestMove.to] != Piece.Empty;
        this.forceMakeMove(this.evalBestMove.from, { index: this.evalBestMove.to, data: this.evalBestMove.data }, true);

        const endTime = self.performance.now();
        this.timeTakenLastTurn = endTime - startTime; // ms
    }

    attemptMove = (fromIndex: number, toIndex: number) => {
        const movingPiece = this.board[fromIndex];

        // do not allow moves when looking back
        if (this.historicalIndex != 0)
            return false;

        if (this.checkForDraw())
            return false;

        // no-op moves
        if (fromIndex == toIndex || movingPiece == Piece.Empty)
            return false;

        // only move correct color pieces on correct turn
        if ((this.whiteTurn && movingPiece < Piece.King_W) || (!this.whiteTurn && movingPiece > Piece.Pawn_B))
            return false;

        const validMoves = this.getAllValidMoves();
        if (!validMoves.some(e => e.from == fromIndex && e.to == toIndex))
            return false;

        this.castledThisTurn = this.updateCastleStatus(fromIndex, toIndex);
        this.pieceCapturedThisTurn = this.board[toIndex] != Piece.Empty; // todo: en passant capture noise doesn't work with this
        this.forceMakeMove(fromIndex, { index: toIndex, data: this.whiteTurn ? Piece.Queen_W : Piece.Queen_B }, true); // auto promote to queen when possible

        return true;
    }

    resetGame = () => {
        this.historicalBoards = [];
        this.historicalIndex = 0;
        this.currentOpening = "";
        this.moveList = [];
        for (let i = 0; i < this.pieceLocations.length; i++) {
            this.pieceLocations[i] = [];
        }
        this.board = this.parseFEN("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        this.boardHash = this.hashBoard();
        this.repetitionHistory = [];
        this.repetitionHistory.push(this.boardHash);
        this.allValidMoves = this.getAllValidMoves();
        this.historicalBoards.push(this.createHistoricalBoard());
    }
}

const engine = new Engine();

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.Ready:
            ctx.postMessage({
                command: e.data.command,
            });
            break;
        case EngineCommands.RetrieveBoard:
            ctx.postMessage({
                command: e.data.command,
                board: engine.historicalBoards[engine.historicalBoards.length - 1],
                validMoves: engine.allValidMoves
            });
            break;
        case EngineCommands.AttemptMove:
        {
            const result = engine.attemptMove(e.data.fromIndex, e.data.toIndex);
            ctx.postMessage({
                command: e.data.command,
                from: e.data.fromIndex,
                to: e.data.toIndex,
                whiteTurn: engine.whiteTurn,
                board: result ? engine.historicalBoards[engine.historicalBoards.length - 1] : undefined,
                validMoves: engine.allValidMoves,
                inCheck: engine.inCheck,
                captured: engine.pieceCapturedThisTurn,
                castled: engine.castledThisTurn,
                draw: engine.checkForDraw()
            });
            break;
        }
        case EngineCommands.HistoryGoBack:
        {
            engine.stepBack();
            const index = engine.historicalBoards.length - 1 + engine.historicalIndex;
            ctx.postMessage({
                command: e.data.command,
                board: engine.historicalBoards[index],
                index: index
            });
            break;
        }
        case EngineCommands.HistoryGoForward:
        {
            engine.stepForward();
            const index = engine.historicalBoards.length - 1 + engine.historicalIndex;
            ctx.postMessage({
                command: e.data.command,
                board: engine.historicalBoards[index],
                index: index
            });
            break;
        }
        case EngineCommands.UndoMove:
        {
            if (engine.historicalIndex == 0) {
                engine.undoMove();
                const index = engine.historicalBoards.length - 1;
                ctx.postMessage({
                    command: e.data.command,
                    board: engine.historicalBoards[index],
                    index: index
                });
            }
            break;
        }
        case EngineCommands.BotBestMove:
        {
            if (!(e.data.bookMoves && engine.moveCount <= 5 && engine.bookMove()))
                engine.evalBotMove(6);
            ctx.postMessage({
                command: e.data.command,
                from: engine.evalBestMove.from,
                to: engine.evalBestMove.to,
                timeTaken: engine.timeTakenLastTurn,
                depthSearched: engine.depthSearchedThisTurn,
                opening: engine.currentOpening,
                movesFound: engine.movesFoundThisTurn,
                whiteTurn: engine.whiteTurn,
                board: engine.historicalBoards[engine.historicalBoards.length - 1],
                validMoves: engine.allValidMoves,
                inCheck: engine.inCheck,
                captured: engine.pieceCapturedThisTurn,
                castled: engine.castledThisTurn,
                draw: engine.checkForDraw()
            });
            break;
        }
        case EngineCommands.BotBestMoveIterative:
        {
            if (!(e.data.bookMoves && engine.moveCount <= 5 && engine.bookMove()))
                engine.evalBotMoveIterative();
            //console.log(engine.calculateAllPossibleMoves(5));
            ctx.postMessage({
                command: e.data.command,
                from: engine.evalBestMove.from,
                to: engine.evalBestMove.to,
                timeTaken: engine.timeTakenLastTurn,
                depthSearched: engine.depthSearchedThisTurn,
                opening: engine.currentOpening,
                movesFound: engine.movesFoundThisTurn,
                whiteTurn: engine.whiteTurn,
                board: engine.historicalBoards[engine.historicalBoards.length - 1],
                validMoves: engine.allValidMoves,
                inCheck: engine.inCheck,
                captured: engine.pieceCapturedThisTurn,
                castled: engine.castledThisTurn,
                draw: engine.checkForDraw()
            });
            break;
        }
        case EngineCommands.SetHistory:
        {
            engine.historicalBoards = e.data.boards;
            engine.historicalIndex = e.data.index;
            engine.useHistoricalBoard(e.data.boards[e.data.boards.length - 1 + e.data.index]);
            break;
        }
        case EngineCommands.ResetGame:
        {
            engine.resetGame();
            ctx.postMessage({
                command: e.data.command,
                retrieve: e.data.retrieve
            });
            break;
        }
        case EngineCommands.RetrievePieceLocations:
            ctx.postMessage({ command: e.data.command, locations: engine.pieceLocations });
            break;
        case EngineCommands.UpdateMaxMoveTime:
            engine.searchMaxTime = e.data.time;
            break;
        default:
            break;
    }
});