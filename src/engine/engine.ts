import bigInt from "big-integer";
import { bishopSquareTable, knightSquareTable, pawnSquareTable, Piece, queenSquareTable, rookSquareTable, Value, getPieceName, SavedEvalTypes, EngineCommands } from "../definitions";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

interface HistoricalBoard {
    board: number[];
    whiteTurn: boolean;
    whiteKingIndex: number;
    blackKingIndex: number;
    whiteCanCastle: boolean[];
    blackCanCastle: boolean[];
    whitePieceLocations: Record<number, number[]>;
    blackPieceLocations: Record<number, number[]>;
}

interface BoardDelta {
    index: number;
    piece: number;
    target: number;
    canCastle: boolean[];
}

interface MoveInfo {
    index: number;
    data: number;
}

interface EvalMove {
    from: number;
    to: number;
    data: number;
}

interface DebugMoveOutput {
    from: number;
    to: number;
    piece: number;
    data: number;
    eval: number;
}

interface EvaluationData {
    totalMoves: number;
    eval: number;
    bestMove: EvalMove;
    depth: number;
    type: number;
}

export class Engine {
    boardSize = 8;
    board: number[] = [];
    boardDelta: BoardDelta[] = [];
    boardHash: bigint = BigInt(0);

    zobristHashTable: bigint[][] = [];
    savedEvaluations: Record<string, EvaluationData> = {};
    savedValidMoves: Record<string, Record<number, MoveInfo[]>> = {};
    evalBestMove: EvalMove = { from: -1, to: -1, data: 0 };
    movesFoundThisTurn: DebugMoveOutput[] = [];
    repetitionHistory: bigint[] = [];

    pieceCapturedThisTurn = false;
    castledThisTurn = false;
    timeTakenLastTurn = 0;

    whitePieceLocations: Record<number, number[]> = {
        [Piece.Pawn_W]: [],
        [Piece.Bishop_W]: [],
        [Piece.Knight_W]: [],
        [Piece.Queen_W]: [],
        [Piece.Rook_W]: [],
        [Piece.King_W]: [] // include king for use in specific functions, but it should always stay empty
    }

    blackPieceLocations: Record<number, number[]> = {
        [Piece.Pawn_B]: [],
        [Piece.Bishop_B]: [],
        [Piece.Knight_B]: [],
        [Piece.Queen_B]: [],
        [Piece.Rook_B]: [],
        [Piece.King_B]: []
    }

    moveCount = 0;
    pinnedPieces: number[] = [];
    historicalBoards: HistoricalBoard[] = [];
    historicalIndex = 0;
    whiteTurn = true;
    whiteCanCastle = [true, true]; // kingside, queenside
    blackCanCastle = [true, true];
    whiteKingIndex = -1;
    blackKingIndex = -1;
    enPassantSquare = -1;
    allValidMoves: Record<number, MoveInfo[]> = {};
    fenToPieceDict: Record<string, number> = {
        'K': Piece.King_W,
        'Q': Piece.Queen_W,
        'R': Piece.Rook_W,
        'B': Piece.Bishop_W,
        'N': Piece.Knight_W,
        'P': Piece.Pawn_W,
        'k': Piece.King_B,
        'q': Piece.Queen_B,
        'r': Piece.Rook_B,
        'b': Piece.Bishop_B,
        'n': Piece.Knight_B,
        'p': Piece.Pawn_B
    }

    constructor() {
        this.board = [];

        let startingFEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        //startingFEN = "5ppp/4Ppkp/5ppp/8/6q1/5P2/1K6/8 w - - 0 1"; // king in a box
        //startingFEN = "1rk4r/1pp3pp/p2b4/1n3P2/6P1/2nK4/7P/8 b - - 0 1"; // promotion break
        //startingFEN = "r3kb1r/ppp1pppp/2n5/6B1/4P1n1/2N5/PPP2PPP/R2K2NR w - - 0 1"; // fork
        //startingFEN = "rr2kb2/ppp1pppp/2n3n1/7B/B7/2N5/PPP2PPP/R2KR1N1 b - - 0 1"; // pins
        startingFEN = "2N5/4k2p/p3pp2/6p1/8/P4n1P/4r3/1K1R4 b - - 0 1"; // threefold
        this.board = this.parseFEN(startingFEN);
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] == Piece.King_W)
                this.whiteKingIndex = i;
            else if (this.board[i] == Piece.King_B)
                this.blackKingIndex = i;
        }
        this.historicalBoards.push(this.createHistoricalBoard());
        this.allValidMoves = this.getAllValidMoves(false);

        // initialize the hash table
        const maxVal: bigInt.BigNumber = bigInt(2).pow(64).minus(1);
        for (let i = 0; i < 64; i++) {
            this.zobristHashTable.push([]);
            for (let j = 0; j < 12; j++) {
                this.zobristHashTable[i].push(BigInt(bigInt.randBetween(0, maxVal)));
            }
        }

        // castle values
        for (let i = 0; i < 4; i++) {
            this.zobristHashTable.push([]);
            for (let j = 0; j < 2; j++) {
                this.zobristHashTable[i + 64].push(BigInt(bigInt.randBetween(0, maxVal)));
            }
        }

        // turn
        this.zobristHashTable.push([BigInt(bigInt.randBetween(0, maxVal)), BigInt(bigInt.randBetween(0, maxVal))]);

        // en passant
        const enPassantSquares: bigint[] = [];
        for (let i = 0; i < 64; i++) {
            enPassantSquares.push(BigInt(bigInt.randBetween(0, maxVal)));
        }
        this.zobristHashTable.push(enPassantSquares);

        this.boardHash = this.hashBoard();
    }

    createHistoricalBoard = () => {
        let newWhitePieceLocations: Record<number, number[]> = {...this.whitePieceLocations}
        for (let key in newWhitePieceLocations) {
            newWhitePieceLocations[key] = [...newWhitePieceLocations[key]]
        }
        let newBlackPieceLocations: Record<number, number[]> = {...this.blackPieceLocations}
        for (let key in newBlackPieceLocations) {
            newBlackPieceLocations[key] = [...newBlackPieceLocations[key]]
        }
        
        return ({
            board:  [...this.board],
            whiteTurn: this.whiteTurn,
            whiteKingIndex: this.whiteKingIndex,
            blackKingIndex: this.blackKingIndex,
            whiteCanCastle: [...this.whiteCanCastle],
            blackCanCastle: [...this.blackCanCastle],
            whitePieceLocations: newWhitePieceLocations,
            blackPieceLocations: newBlackPieceLocations
        });
    }

    useHistoricalBoard = (historicalBoard: HistoricalBoard) => {
        this.board = [...historicalBoard.board];
        this.whiteTurn = historicalBoard.whiteTurn;
        this.whiteKingIndex = historicalBoard.whiteKingIndex;
        this.blackKingIndex = historicalBoard.blackKingIndex;
        this.whiteCanCastle = [...historicalBoard.whiteCanCastle];
        this.blackCanCastle = [...historicalBoard.blackCanCastle];
        this.whitePieceLocations = {...historicalBoard.whitePieceLocations};
        this.blackPieceLocations = {...historicalBoard.blackPieceLocations};
        this.savedEvaluations = {};
        this.savedValidMoves = {};
        this.allValidMoves = this.getAllValidMoves(false);
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
        hash = hash ^ this.zobristHashTable[64][(this.whiteCanCastle[0] ? 0 : 1)];
        hash = hash ^ this.zobristHashTable[65][(this.whiteCanCastle[1] ? 0 : 1)];
        hash = hash ^ this.zobristHashTable[66][(this.blackCanCastle[0] ? 0 : 1)];
        hash = hash ^ this.zobristHashTable[67][(this.blackCanCastle[1] ? 0 : 1)];

        // turn
        hash = hash ^ this.zobristHashTable[68][(this.whiteTurn ? 0 : 1)];

        // en passant
        if (this.enPassantSquare != -1)
            hash = hash ^ this.zobristHashTable[69][this.enPassantSquare];

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
                    const piece = this.fenToPieceDict[terms[t]];
                    board[boardIndex] = piece;

                    if (piece > 7)
                        this.whitePieceLocations[piece].push(boardIndex);
                    else if (piece < 7 && piece > 1)
                        this.blackPieceLocations[piece].push(boardIndex);

                    boardIndex++;
                }
                else
                    boardIndex += numberVal;
            }
        }

        this.whiteTurn = fields[1] == 'w';

        this.whiteCanCastle = [fields[2].includes('K'), fields[2].includes('Q')];
        this.blackCanCastle = [fields[2].includes('k'), fields[2].includes('q')];

        return board;
    }

    traceValidSquares = (index: number, slopeX: number, slopeY: number, white: boolean, onlyEmpty: boolean, updatePins: boolean, inArray: number[]) => {
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
                    } else if (this.board[currentIndex] == Piece.Empty || (white && this.board[currentIndex] < 7) || (!white && this.board[currentIndex] >= 7)) {
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

            const x = currentIndex % this.boardSize;
            const y = Math.floor(currentIndex / this.boardSize);
            if (slopeX == -1 && x == 0)
                break;
            if (slopeX == 1 && x == xyMax)
                break;
            if (slopeY == -1 && y == 0)
                break;
            if (slopeY == 1 && y == xyMax)
                break;

            currentIndex += slopeX + (slopeY * this.boardSize);
        }
    }

    getValidSquares = (index: number, piece: number, attackOnly: boolean, updatePins: boolean, inArray: number[]) => {
        const x = index % this.boardSize;
        const y = Math.floor(index / this.boardSize);
        const xyMax = this.boardSize - 1;

        const isWhite = piece >= 7;
        switch (piece) {
            case Piece.Rook_W:
            case Piece.Rook_B:
                this.traceValidSquares(index, 1, 0, isWhite, false, updatePins, inArray); // right
                this.traceValidSquares(index, -1, 0, isWhite, false, updatePins, inArray); // left
                this.traceValidSquares(index, 0, 1, isWhite, false, updatePins, inArray); // down
                this.traceValidSquares(index, 0, -1, isWhite, false, updatePins, inArray); // up
                break;
            case Piece.Queen_W:
            case Piece.Queen_B:
                this.traceValidSquares(index, 1, 0, isWhite, false, updatePins, inArray); // right
                this.traceValidSquares(index, -1, 0, isWhite, false, updatePins, inArray); // left
                this.traceValidSquares(index, 0, 1, isWhite, false, updatePins, inArray); // down
                this.traceValidSquares(index, 0, -1, isWhite, false, updatePins, inArray); // up
                this.traceValidSquares(index, 1, -1, isWhite, false, updatePins, inArray); // up right
                this.traceValidSquares(index, -1, -1, isWhite, false, updatePins, inArray); // up left
                this.traceValidSquares(index, 1, 1, isWhite, false, updatePins, inArray); // down right
                this.traceValidSquares(index, -1, 1, isWhite, false, updatePins, inArray); // down left
                break;
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                this.traceValidSquares(index, 1, -1, isWhite, false, updatePins, inArray); // up right
                this.traceValidSquares(index, -1, -1, isWhite, false, updatePins, inArray); // up left
                this.traceValidSquares(index, 1, 1, isWhite, false, updatePins, inArray); // down right
                this.traceValidSquares(index, -1, 1, isWhite, false, updatePins, inArray); // down left
                break;
            //todo: en passant
            case Piece.Pawn_W:
            {
                const upOne = index - (this.boardSize);
                const upTwo = index - (this.boardSize * 2);
                const upLeft = upOne - 1;
                const upRight = upOne + 1;
                if (!attackOnly) {
                    if (upOne >= 0 && this.board[upOne] == Piece.Empty)
                        inArray.push(upOne);
                    if (y == 6 && this.board[upTwo] == Piece.Empty && this.board[upOne] == Piece.Empty)
                        inArray.push(upTwo);
                }
                if (x != 0 && upLeft >= 0 && (this.board[upLeft] != Piece.Empty || upLeft == this.enPassantSquare || attackOnly) && (this.board[upLeft] < 7 || upLeft == this.enPassantSquare))
                    inArray.push(upLeft);
                if (x != xyMax && upRight >= 0 && (this.board[upRight] != Piece.Empty || upRight == this.enPassantSquare || attackOnly) && (this.board[upRight] < 7 || upRight == this.enPassantSquare))
                    inArray.push(upRight);
                break;
            }
            case Piece.Pawn_B:
            {
                const downOne = index + (this.boardSize);
                const downTwo = index + (this.boardSize * 2);
                const downLeft = downOne - 1;
                const downRight = downOne + 1;
                if (!attackOnly) {
                    if (downOne < this.board.length && this.board[downOne] == Piece.Empty)
                        inArray.push(downOne);
                    if (y == 1 && this.board[downTwo] == Piece.Empty && this.board[downOne] == Piece.Empty)
                        inArray.push(downTwo);
                }
                if (x != 0 && downLeft < this.board.length && (this.board[downLeft] != Piece.Empty || downLeft == this.enPassantSquare || attackOnly) && (this.board[downLeft] >= 7 || this.board[downLeft] == Piece.Empty || downLeft == this.enPassantSquare))
                    inArray.push(downLeft);
                if (x != xyMax && downRight < this.board.length && (this.board[downRight] != Piece.Empty || downRight == this.enPassantSquare || attackOnly) && (this.board[downRight] >= 7 || this.board[downRight] == Piece.Empty || downRight == this.enPassantSquare))
                    inArray.push(downRight);
                break;
            }
            case Piece.King_W:
            case Piece.King_B:
            {
                const upOne = index - (this.boardSize);
                const downOne = index + (this.boardSize);
                const leftOne = index - 1;
                const rightOne = index + 1;
                const upLeft = upOne - 1;
                const upRight = upOne + 1;
                const downLeft = downOne - 1;
                const downRight = downOne + 1;

                if (upOne >= 0 && (this.board[upOne] == Piece.Empty || (isWhite && this.board[upOne] < 7) || (!isWhite && this.board[upOne] >= 7)))
                    inArray.push(upOne);
                if (downOne < this.board.length && (this.board[downOne] == Piece.Empty || (isWhite && this.board[downOne] < 7) || (!isWhite && this.board[downOne] >= 7)))
                    inArray.push(downOne);
                if (x != 0 && leftOne >= 0 && (this.board[leftOne] == Piece.Empty || (isWhite && this.board[leftOne] < 7) || (!isWhite && this.board[leftOne] >= 7)))
                    inArray.push(leftOne);
                if (x != xyMax && rightOne < this.board.length && (this.board[rightOne] == Piece.Empty || (isWhite && this.board[rightOne] < 7) || (!isWhite && this.board[rightOne] >= 7)))
                    inArray.push(rightOne);

                if (x != 0 && upLeft >= 0 && (this.board[upLeft] == Piece.Empty || (isWhite && this.board[upLeft] < 7) || (!isWhite && this.board[upLeft] >= 7)))
                    inArray.push(upLeft);
                if (x != xyMax && upRight >= 0 && (this.board[upRight] == Piece.Empty || (isWhite && this.board[upRight] < 7) || (!isWhite && this.board[upRight] >= 7)))
                    inArray.push(upRight);
                if (x != 0 && downLeft < this.board.length && (this.board[downLeft] == Piece.Empty || (isWhite && this.board[downLeft] < 7) || (!isWhite && this.board[downLeft] >= 7)))
                    inArray.push(downLeft);
                if (x != xyMax && downRight < this.board.length && (this.board[downRight] == Piece.Empty || (isWhite && this.board[downRight] < 7) || (!isWhite && this.board[downRight] >= 7)))
                    inArray.push(downRight);
                
                break;
            }
            case Piece.Knight_W:
            case Piece.Knight_B:
            {
                const upLeftOne = index - (this.boardSize) - 2;
                const upLeftTwo = index - (this.boardSize * 2) - 1;
                const upRightOne = index - (this.boardSize * 2) + 1;
                const upRightTwo = index - (this.boardSize) + 2;
                const bottomLeftOne = index + (this.boardSize) - 2;
                const bottomLeftTwo = index + (this.boardSize * 2) - 1;
                const bottomRightOne = index + (this.boardSize * 2) + 1;
                const bottomRightTwo = index + (this.boardSize) + 2;

                if (x >= 2 && y >= 1 && (this.board[upLeftOne] == Piece.Empty || (isWhite && this.board[upLeftOne] < 7) || (!isWhite && this.board[upLeftOne] >= 7)))
                    inArray.push(upLeftOne);
                if (x >= 1 && y >= 2 && (this.board[upLeftTwo] == Piece.Empty || (isWhite && this.board[upLeftTwo] < 7) || (!isWhite && this.board[upLeftTwo] >= 7)))
                    inArray.push(upLeftTwo);
                if (x <= xyMax - 1 && y >= 2 && (this.board[upRightOne] == Piece.Empty || (isWhite && this.board[upRightOne] < 7) || (!isWhite && this.board[upRightOne] >= 7)))
                    inArray.push(upRightOne);
                if (x <= xyMax - 2 && y >= 1 && (this.board[upRightTwo] == Piece.Empty || (isWhite && this.board[upRightTwo] < 7) || (!isWhite && this.board[upRightTwo] >= 7)))
                    inArray.push(upRightTwo);
                
                if (x >= 2 && y <= xyMax - 1 && (this.board[bottomLeftOne] == Piece.Empty || (isWhite && this.board[bottomLeftOne] < 7) || (!isWhite && this.board[bottomLeftOne] >= 7)))
                    inArray.push(bottomLeftOne);
                if (x >= 1 && y <= xyMax - 2 && (this.board[bottomLeftTwo] == Piece.Empty || (isWhite && this.board[bottomLeftTwo] < 7) || (!isWhite && this.board[bottomLeftTwo] >= 7)))
                    inArray.push(bottomLeftTwo);
                if (x <= xyMax - 1 && y <= xyMax - 2 && (this.board[bottomRightOne] == Piece.Empty || (isWhite && this.board[bottomRightOne] < 7) || (!isWhite && this.board[bottomRightOne] >= 7)))
                    inArray.push(bottomRightOne);
                if (x <= xyMax - 2 && y <= xyMax - 1 && (this.board[bottomRightTwo] == Piece.Empty || (isWhite && this.board[bottomRightTwo] < 7) || (!isWhite && this.board[bottomRightTwo] >= 7)))
                    inArray.push(bottomRightTwo);
                
                break;
            }
            default:
                break;
        }
    }

    getAttackedSquares = (white: boolean, toIndex: number) => {
        let attackedSquares: number[] = [];

        let pieces: Record<number, number[]> = this.whitePieceLocations;
        if (white)
            pieces = this.blackPieceLocations;

        for (let key in pieces) {
            const piece = parseInt(key);
            if (isNaN(piece) || piece == Piece.Empty)
                continue;

            const locations = pieces[key];
            const length = locations.length;
            for (let i = 0; i < length; i++) {
                if (locations[i] == toIndex) // when searching for valid moves, instead of modifying the piece dictionaries, just ignore any piece that would have been captured
                    continue;
                this.getValidSquares(locations[i], piece, true, false, attackedSquares);
            }
        }
        // account for king moves
        if (white) {
            this.getValidSquares(this.blackKingIndex, Piece.King_B, true, false, attackedSquares);
        } else {
            this.getValidSquares(this.whiteKingIndex, Piece.King_W, true, false, attackedSquares);
        }

        return attackedSquares;
    }

    updatePinnedSquares = (white: boolean) => {
        let tempArray: number[] = [];

        // we only care about sliding pieces of the opposite color for pins
        let pieces: Record<number, number[]> = {};
        if (white) {
            pieces[Piece.Rook_B] = this.blackPieceLocations[Piece.Rook_B];
            pieces[Piece.Queen_B] = this.blackPieceLocations[Piece.Queen_B];
            pieces[Piece.Bishop_B] = this.blackPieceLocations[Piece.Bishop_B];
        } else {
            pieces[Piece.Rook_W] = this.whitePieceLocations[Piece.Rook_W];
            pieces[Piece.Queen_W] = this.whitePieceLocations[Piece.Queen_W];
            pieces[Piece.Bishop_W] = this.whitePieceLocations[Piece.Bishop_W];
        }

        for (let key in pieces) {
            const piece = parseInt(key);
            if (isNaN(piece) || piece == Piece.Empty)
                continue;

            const locations = pieces[key];
            const length = locations.length;
            for (let i = 0; i < length; i++) {
                this.getValidSquares(locations[i], piece, true, true, tempArray);
            }
        }
    }

    getValidCastleSquares = () => {
        let validCastleSquares: Record<number, MoveInfo[]> = {};
        const attackedSquares = this.getAttackedSquares(this.whiteTurn, -1);

        if (this.whiteTurn) {
            let traced: number[] = [];
            this.traceValidSquares(60, 1, 0, false, true, false, traced);
            if (this.whiteCanCastle[0] && this.board[63] == Piece.Rook_W && traced.length == 2) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(61) && !attackedSquares.includes(62)) {
                    if (60 in validCastleSquares)
                        validCastleSquares[60].push({ index: 62, data: 0 });
                    else
                        validCastleSquares[60] = [{ index: 62, data: 0 }];
                }
            }
            traced = [];
            this.traceValidSquares(60, -1, 0, false, true, false, traced);
            if (this.whiteCanCastle[1] && this.board[56] == Piece.Rook_W && traced.length == 3) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(59) && !attackedSquares.includes(58)) {
                    if (60 in validCastleSquares)
                        validCastleSquares[60].push({ index: 58, data: 0 });
                    else
                        validCastleSquares[60] = [{ index: 58, data: 0 }];
                }
            }
        } else {
            let traced: number[] = [];
            this.traceValidSquares(4, 1, 0, false, true, false, traced);
            if (this.blackCanCastle[0] && this.board[7] == Piece.Rook_B && traced.length == 2) {
                if (!attackedSquares.includes(4) && !attackedSquares.includes(5) && !attackedSquares.includes(6)) {
                    if (4 in validCastleSquares)
                        validCastleSquares[4].push({ index: 6, data: 0 });
                    else
                        validCastleSquares[4] = [{ index: 6, data: 0 }];
                }
            }
            traced = [];
            this.traceValidSquares(4, -1, 0, false, true, false, traced);
            if (this.blackCanCastle[1] && this.board[0] == Piece.Rook_B && traced.length == 3) {
                if (!attackedSquares.includes(4) && !attackedSquares.includes(3) && !attackedSquares.includes(2)) {
                    if (4 in validCastleSquares)
                        validCastleSquares[4].push({ index: 2, data: 0 });
                    else
                        validCastleSquares[4] = [{ index: 2, data: 0 }];
                }
            }
        }

        return validCastleSquares;
    }

    isInCheck = (white: boolean) => {
        const attacked = this.getAttackedSquares(white, -1);
        return ((white && attacked.includes(this.whiteKingIndex)) || (!white && attacked.includes(this.blackKingIndex)));
    }

    getAllValidMoves = (bothSides: boolean) => {
        const hashString = this.boardHash.toString();
        if (hashString in this.savedValidMoves) {
            return this.savedValidMoves[hashString];
        }

        let allValid: Record<number, MoveInfo[]> = {};

        const validCastleSquares = this.getValidCastleSquares();
        for (let key in validCastleSquares) {
            allValid[key] = validCastleSquares[key];
        }

        let pieces: Record<number, number[]> = this.blackPieceLocations;
        if (this.whiteTurn) { // add the king temporarily
            pieces = this.whitePieceLocations;
            pieces[Piece.King_W] = [this.whiteKingIndex];
        } else {
            pieces[Piece.King_B] = [this.blackKingIndex];
        }

        this.pinnedPieces = [];
        this.updatePinnedSquares(this.whiteTurn);
        const inCheck = this.isInCheck(this.whiteTurn);

        for (let key in pieces) {
            const movingPiece = parseInt(key);
            if (isNaN(movingPiece) || movingPiece == Piece.Empty)
                continue;

            const locations = pieces[key];
            const length = locations.length;
            for (let i = 0; i < length; i++) {
                const location = locations[i];

                let valid: number[] = [];
                this.getValidSquares(location, movingPiece, false, false, valid);

                const isPinned = this.pinnedPieces.includes(location);
                const validLength = valid.length;
                for (let j = 0; j < validLength; j++) {
                    if (inCheck || isPinned || movingPiece == Piece.King_W || movingPiece == Piece.King_B) { // more optimizations can definitely be made here
                    //if (true) {
                        const pieceBackup = this.board[valid[j]];
                        const backup2 = this.board[location];
                        this.board[valid[j]] = movingPiece;
                        this.board[location] = Piece.Empty;
                        const attacked: number[] = this.getAttackedSquares(this.whiteTurn, valid[j]);
                        this.board[valid[j]] = pieceBackup;
                        this.board[location] = backup2;
                        if (movingPiece == Piece.King_W || movingPiece == Piece.King_B) {
                            if (attacked.includes(valid[j]))
                                continue;
                        }
                        else if ((this.whiteTurn && attacked.includes(this.whiteKingIndex)) || (!this.whiteTurn && attacked.includes(this.blackKingIndex)))
                            continue;
                    }

                    // add more moves to account for promoting to various pieces
                    const y = Math.floor(valid[j] / this.boardSize);
                    if (movingPiece == Piece.Pawn_W && y == 0) {
                        if (location in allValid)
                            allValid[location].push({ index: valid[j], data: Piece.Queen_W });
                        else
                            allValid[location] = [{ index: valid[j], data: Piece.Queen_W }];
                        allValid[location].push({ index: valid[j], data: Piece.Bishop_W });
                        allValid[location].push({ index: valid[j], data: Piece.Knight_W });
                        allValid[location].push({ index: valid[j], data: Piece.Rook_W });
                    } else if (movingPiece == Piece.Pawn_B && y == 7) {
                        if (location in allValid)
                            allValid[location].push({ index: valid[j], data: Piece.Queen_B });
                        else
                            allValid[location] = [{ index: valid[j], data: Piece.Queen_B }];
                        allValid[location].push({ index: valid[j], data: Piece.Bishop_B });
                        allValid[location].push({ index: valid[j], data: Piece.Knight_B });
                        allValid[location].push({ index: valid[j], data: Piece.Rook_B });
                    } else {
                        if (location in allValid)
                            allValid[location].push({ index: valid[j], data: 0 });
                        else
                            allValid[location] = [{ index: valid[j], data: 0 }];
                    }
                }
            }
        }

        if (this.whiteTurn) { // remove the king
            pieces[Piece.King_W] = [];
        } else {
            pieces[Piece.King_B] = [];
        }

        this.savedValidMoves[hashString] = allValid;
        return allValid;
    }

    finishTurn = () => {
        this.whiteTurn = !this.whiteTurn;
        this.historicalBoards.push(this.createHistoricalBoard());
        this.boardHash = this.hashBoard();
        this.boardDelta = [];
        this.allValidMoves = this.getAllValidMoves(false);
        this.savedEvaluations = {};
        this.savedValidMoves = {};

        // debug print found moves
        for (let i = 0; i < this.movesFoundThisTurn.length; i++) {
            const move = this.movesFoundThisTurn[i];
            const data = getPieceName(move.data);
            const dataString = data != "" ? ` promoting to ${data}` : ""
            console.log(`Move: ${getPieceName(move.piece)} from ${move.from} to ${move.to}${dataString} with eval ${move.eval}`);
        }
        console.log("DONE")
        this.movesFoundThisTurn = [];

        //console.log(`Finished move ${this.moveCount}`)
        this.moveCount++;
    }

    forceMakeMove = (fromIndex: number, move: MoveInfo, finishTurn: boolean) => {
        const toIndex = move.index;
        const movingPiece = this.board[fromIndex];
        const capturedPiece = this.board[toIndex];

        this.boardDelta.push({ index: toIndex, piece: capturedPiece, target: -1, canCastle: [] });
        this.boardDelta.push({ index: fromIndex, piece: movingPiece, target: toIndex, canCastle: [] });
        this.board[toIndex] = this.board[fromIndex];
        this.board[fromIndex] = Piece.Empty;

        // promotion check
        let promoted = false;
        const y = Math.floor(toIndex / this.boardSize);
        if (this.board[toIndex] == Piece.Pawn_W && y == 0) {
            this.board[toIndex] = move.data;
            this.whitePieceLocations[Piece.Pawn_W].splice(this.whitePieceLocations[Piece.Pawn_W].indexOf(fromIndex), 1); // remove pawn entry
            this.whitePieceLocations[move.data].push(toIndex); // add new piece entry
            this.boardDelta.push({ index: -1, piece: move.data, target: toIndex, canCastle: [] }); // add promotion delta
            promoted = true;
        }
        else if (this.board[toIndex] == Piece.Pawn_B && y == 7) {
            this.board[toIndex] = move.data;
            this.blackPieceLocations[Piece.Pawn_B].splice(this.blackPieceLocations[Piece.Pawn_B].indexOf(fromIndex), 1); // remove pawn entry
            this.blackPieceLocations[move.data].push(toIndex); // add new piece entry
            this.boardDelta.push({ index: -1, piece: move.data, target: toIndex, canCastle: [] }); // add promotion delta
            promoted = true;
        }

        // en passant check
        if (toIndex == this.enPassantSquare) { // capturing en passant, so remove the pawn and add a delta
            if (movingPiece == Piece.Pawn_W) {
                this.boardDelta.push({ index: toIndex + 8, piece: Piece.Pawn_B, target: -1, canCastle: [] });
                this.board[toIndex + 8] = Piece.Empty;
            } else if (movingPiece == Piece.Pawn_B) {
                this.boardDelta.push({ index: toIndex - 8, piece: Piece.Pawn_W, target: -1, canCastle: [] });
                this.board[toIndex - 8] = Piece.Empty;
            }
        }

        if (movingPiece == Piece.Pawn_W && fromIndex - toIndex == 16) { // moving two spaces up
            this.enPassantSquare = fromIndex - 8;
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [] });
        }
        else if (movingPiece == Piece.Pawn_B && toIndex - fromIndex == 16) { // moving two spaces down
            this.enPassantSquare = fromIndex + 8;
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [] });
        }
        else {
            this.enPassantSquare = -1;
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [] });
        }

        // update moved piece position unless promoted since that is already handled
        if (!promoted) {
            if (movingPiece > 7) { // white
                this.whitePieceLocations[movingPiece].splice(this.whitePieceLocations[movingPiece].indexOf(fromIndex), 1, toIndex); // update stored position
            } else if (movingPiece > 1 && movingPiece < 7) { // black
                this.blackPieceLocations[movingPiece].splice(this.blackPieceLocations[movingPiece].indexOf(fromIndex), 1, toIndex); // update stored position
            }
        }

        // remove captured piece
        if (capturedPiece != Piece.Empty) {
            if (capturedPiece > 7) { // white
                this.whitePieceLocations[capturedPiece].splice(this.whitePieceLocations[capturedPiece].indexOf(toIndex), 1); // remove entry
            } else if (capturedPiece > 1 && capturedPiece < 7) { // black
                this.blackPieceLocations[capturedPiece].splice(this.blackPieceLocations[capturedPiece].indexOf(toIndex), 1); // remove entry
            }
        }

        if (finishTurn) {
            // update board repetition history
            if (movingPiece == Piece.Pawn_W || movingPiece == Piece.Pawn_W || capturedPiece != Piece.Empty) { // repetitions not possible with these moves
                this.repetitionHistory = [];
            } else {
                this.repetitionHistory.push(this.hashBoard());
            }

            this.finishTurn();
        }
    }

    unmakeMove = (deltas: BoardDelta[]) => {
        this.whiteTurn = !this.whiteTurn;

        for (let i = 0; i < deltas.length; i++) {
            if (deltas[i].piece != Piece.Empty) { // ignore any empty piece entries
                if (deltas[i].index == -1) { // if the original index is -1, it means the piece was created from promotion, so remove the piece
                    if (deltas[i].piece > 7) { // white
                        this.whitePieceLocations[deltas[i].piece].splice(this.whitePieceLocations[deltas[i].piece].indexOf(deltas[i].target), 1); // remove entry
                    } else if (deltas[i].piece > 1 && deltas[i].piece < 7) { // black
                        this.blackPieceLocations[deltas[i].piece].splice(this.blackPieceLocations[deltas[i].piece].indexOf(deltas[i].target), 1); // remove entry
                    }
                }
                else if (this.board[deltas[i].index] != Piece.Empty) { // was captured so add the piece back to register
                    if (deltas[i].piece > 7) { // white
                        this.whitePieceLocations[deltas[i].piece].push(deltas[i].index);
                    } else if (deltas[i].piece > 1 && deltas[i].piece < 7) { // black
                        this.blackPieceLocations[deltas[i].piece].push(deltas[i].index);
                    }
                } else if (deltas[i].target != -1) { // otherwise just move it back
                    if (deltas[i].piece > 7) { // white
                        const foundIndex = this.whitePieceLocations[deltas[i].piece].indexOf(deltas[i].target);
                        if (foundIndex != -1)
                            this.whitePieceLocations[deltas[i].piece].splice(foundIndex, 1, deltas[i].index); // replace with new location
                        else
                            this.whitePieceLocations[deltas[i].piece].push(deltas[i].index);
                    } else if (deltas[i].piece > 1 && deltas[i].piece < 7) { // black
                        const foundIndex = this.blackPieceLocations[deltas[i].piece].indexOf(deltas[i].target);
                        if (foundIndex != -1)
                            this.blackPieceLocations[deltas[i].piece].splice(foundIndex, 1, deltas[i].index); // replace with new location
                        else
                            this.blackPieceLocations[deltas[i].piece].push(deltas[i].index);
                    }
                }
            }

            if (deltas[i].index != -1)
                this.board[deltas[i].index] = deltas[i].piece;

            if (deltas[i].piece == Piece.King_W)
                this.whiteKingIndex = deltas[i].index;
            else if (deltas[i].piece == Piece.King_B)
                this.blackKingIndex = deltas[i].index;
            if (deltas[i].canCastle.length > 0) {
                if (this.whiteTurn)
                    this.whiteCanCastle = deltas[i].canCastle;
                else
                    this.blackCanCastle = deltas[i].canCastle;
            }
        }
    }

    updateCastleStatus = (fromIndex: number, toIndex: number) => {
        const movingPiece = this.board[fromIndex];
        let castled = false;

        if (movingPiece == Piece.King_W) {
            if (this.whiteCanCastle[0] && toIndex == 62) {
                this.boardDelta.push({ index: 63, piece: this.board[63], target: 61, canCastle: [...this.whiteCanCastle] });
                this.boardDelta.push({ index: 61, piece: this.board[61], target: -1, canCastle: [...this.whiteCanCastle] });
                this.whitePieceLocations[Piece.Rook_W].splice(this.whitePieceLocations[Piece.Rook_W].indexOf(63), 1, 61); // replace with new location
                this.board[63] = Piece.Empty;
                this.board[61] = Piece.Rook_W;
                castled = true;
            } else if (this.whiteCanCastle[1] && toIndex == 58) {
                this.boardDelta.push({ index: 56, piece: this.board[56], target: 59, canCastle: [...this.whiteCanCastle] });
                this.boardDelta.push({ index: 59, piece: this.board[59], target: -1, canCastle: [...this.whiteCanCastle] });
                this.whitePieceLocations[Piece.Rook_W].splice(this.whitePieceLocations[Piece.Rook_W].indexOf(56), 1, 59); // replace with new location
                this.board[56] = Piece.Empty;
                this.board[59] = Piece.Rook_W;
                castled = true;
            } else {
                this.boardDelta.push({ index: fromIndex, piece: Piece.King_W, target: toIndex, canCastle: [...this.whiteCanCastle] });
            }

            this.whiteKingIndex = toIndex;
            this.whiteCanCastle = [false, false];
        }
        else if (movingPiece == Piece.King_B) {
            if (this.blackCanCastle[0] && toIndex == 6) {
                this.boardDelta.push({ index: 7, piece: this.board[7], target: 5, canCastle: [...this.blackCanCastle] });
                this.boardDelta.push({ index: 5, piece: this.board[5], target: -1, canCastle: [...this.blackCanCastle] });
                this.blackPieceLocations[Piece.Rook_B].splice(this.blackPieceLocations[Piece.Rook_B].indexOf(7), 1, 5); // replace with new location
                this.board[7] = Piece.Empty;
                this.board[5] = Piece.Rook_B;
                castled = true;
            } else if (this.blackCanCastle[1] && toIndex == 2) {
                this.boardDelta.push({ index: 0, piece: this.board[0], target: 3, canCastle: [...this.blackCanCastle] });
                this.boardDelta.push({ index: 3, piece: this.board[3], target: -1, canCastle: [...this.blackCanCastle] });
                this.blackPieceLocations[Piece.Rook_B].splice(this.blackPieceLocations[Piece.Rook_B].indexOf(0), 1, 3); // replace with new location
                this.board[0] = Piece.Empty;
                this.board[3] = Piece.Rook_B;
                castled = true;
            } else {
                this.boardDelta.push({ index: fromIndex, piece: Piece.King_B, target: toIndex, canCastle: [...this.blackCanCastle] });
            }

            this.blackKingIndex = toIndex;
            this.blackCanCastle = [false, false];
        } // add castling info deltas
        else if (movingPiece == Piece.Rook_W && fromIndex == 56) {
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [...this.whiteCanCastle] });
            this.whiteCanCastle[1] = false; // queenside
        }
        else if (movingPiece == Piece.Rook_W && fromIndex == 63) {
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [...this.whiteCanCastle] });
            this.whiteCanCastle[0] = false; // kingside
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 0) {
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [...this.blackCanCastle] });
            this.blackCanCastle[1] = false; // queenside
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 7) {
            this.boardDelta.push({ index: -1, piece: Piece.Empty, target: -1, canCastle: [...this.blackCanCastle] });
            this.blackCanCastle[0] = false; // kingside
        }

        return castled;
    }    

    unwrapMoves = (moveList: Record<number, MoveInfo[]>) => {
        let moves: Record<number, number[]> = {};
        for (let key in moveList) {
            const movingPiece = parseInt(key);
            if (isNaN(movingPiece) || movingPiece == Piece.Empty)
                continue;

            moves[key] = [];
            for (let i = 0; i < moveList[key].length; i++) {
                moves[key].push(moveList[key][i].index);
            }
        }
        return moves;
    }

    updateHash = (delta: BoardDelta[], hash: bigint, oldEnPassant: number, oldBlackCanCastle: boolean[], oldWhiteCanCastle: boolean[]) => {
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
        if (oldWhiteCanCastle[0] != this.whiteCanCastle[0]) {
            hash = hash ^ this.zobristHashTable[64][0];
            hash = hash ^ this.zobristHashTable[64][1];
        }
        if (oldWhiteCanCastle[1] != this.whiteCanCastle[1]) {
            hash = hash ^ this.zobristHashTable[65][0];
            hash = hash ^ this.zobristHashTable[65][1];
        }
        if (oldBlackCanCastle[0] != this.blackCanCastle[0]) {
            hash = hash ^ this.zobristHashTable[66][0];
            hash = hash ^ this.zobristHashTable[66][1];
        }
        if (oldBlackCanCastle[1] != this.blackCanCastle[1]) {
            hash = hash ^ this.zobristHashTable[67][0];
            hash = hash ^ this.zobristHashTable[67][1];
        }

        // en passant
        if (oldEnPassant != this.enPassantSquare) {
            if (oldEnPassant != -1)
                newHash = newHash ^ this.zobristHashTable[69][oldEnPassant];
            if (this.enPassantSquare != -1)
                newHash = newHash ^ this.zobristHashTable[69][this.enPassantSquare];
        }

        // turn
        newHash = newHash ^ this.zobristHashTable[68][0];
        newHash = newHash ^ this.zobristHashTable[68][1];
        return newHash;
    }

    predictAndOrderMoves = (moves: Record<number, MoveInfo[]>) => {
        let finalMoves: { move: EvalMove, score: number }[] = [];
        const attacked: number[] = [];//this.getAttackedSquares(this.whiteTurn, -1);

        for (let key in moves) {
            const pieceIndex = parseInt(key);
            if (isNaN(pieceIndex))
                continue;

            const movesInfo = moves[key];
            const movesInfoLength = moves[key].length;
            for (let i = 0; i < movesInfoLength; i++) {
                let score = 0;
                const movingPiece = this.board[pieceIndex];
                const capturingPiece = this.board[movesInfo[i].index];
                const promoting = movesInfo[i].data;

                if (capturingPiece != Piece.Empty) {
                    score = 10 * this.getPieceValue(capturingPiece) - this.getPieceValue(movingPiece); // apply a higher score for lower val piece capturing higher val
                }

                // deprioritize moving into attacked squares
                if (attacked.includes(pieceIndex)) {
                    score -= this.getPieceValue(movingPiece);
                }

                // score promotion moves
                if (movingPiece == Piece.Pawn_W || movingPiece == Piece.Pawn_B) {
                    switch (promoting) {
                        case Piece.Knight_W:
                        case Piece.Knight_B:
                            score += this.getPieceValue(Piece.Knight_W);
                            break;
                        case Piece.Bishop_W:
                        case Piece.Bishop_B:
                            score += this.getPieceValue(Piece.Bishop_W);
                            break;
                        case Piece.Queen_W:
                        case Piece.Queen_B:
                            score += this.getPieceValue(Piece.Queen_W);
                            break;
                        case Piece.Rook_W:
                        case Piece.Rook_B:
                            score += this.getPieceValue(Piece.Rook_W);
                            break;
                        default:
                            break;
                    }
                }

                finalMoves.push({ move: { from: pieceIndex, to: movesInfo[i].index, data: movesInfo[i].data }, score: score });
            }
        }

        finalMoves.sort((a, b) => {
            return b.score - a.score;
        });
        return finalMoves;
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

        if (white) {
            const positions = this.whitePieceLocations[piece];
            const length = positions.length;
            for (let i = 0; i < length; i++) {
                value += this.readSquareTableValue(positions[i], table, white);
            }
        } else {
            const positions = this.blackPieceLocations[piece];
            const length = positions.length;
            for (let i = 0; i < length; i++) {
                value += this.readSquareTableValue(positions[i], table, white);
            }
        }

        return value;
    }

    evaluateSquareTables = (white: boolean) => {
        let value = 0;

        // ugly
        if (white) {
            value += this.evaluateSquareTable(Piece.Pawn_W, pawnSquareTable, white);
            value += this.evaluateSquareTable(Piece.Rook_W, rookSquareTable, white);
            value += this.evaluateSquareTable(Piece.Knight_W, knightSquareTable, white);
            value += this.evaluateSquareTable(Piece.Bishop_W, bishopSquareTable, white);
            value += this.evaluateSquareTable(Piece.Queen_W, queenSquareTable, white);
        } else {
            value += this.evaluateSquareTable(Piece.Pawn_B, pawnSquareTable, white);
            value += this.evaluateSquareTable(Piece.Rook_B, rookSquareTable, white);
            value += this.evaluateSquareTable(Piece.Knight_B, knightSquareTable, white);
            value += this.evaluateSquareTable(Piece.Bishop_B, bishopSquareTable, white);
            value += this.evaluateSquareTable(Piece.Queen_B, queenSquareTable, white);
        }

        return value;
    }

    evaluate = () => {
        const materialWeight = 1;
        const developmentWeight = 1;

        const whiteMaterial = this.countMaterial(true);
        const blackMaterial = this.countMaterial(false);

        let whiteEval = whiteMaterial * materialWeight;
        let blackEval = blackMaterial * materialWeight;
        
        whiteEval += Math.floor(this.evaluateSquareTables(true) * developmentWeight);
        blackEval += Math.floor(this.evaluateSquareTables(false) * developmentWeight);

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

    countMaterial = (white: boolean) => {
        let value: number = 0;

        let pieces: Record<number, number[]> = this.blackPieceLocations;
        if (white)
            pieces = this.whitePieceLocations;

        for (let key in pieces) {
            const pieceIndex = parseInt(key);
            if (isNaN(pieceIndex))
                continue;

            value += this.getPieceValue(pieceIndex) * pieces[key].length;
        }

        return value;
    }

    // lower bound: alpha, upper bound: beta
    findBestMove = (depth: number, offset: number, alpha: number, beta: number) => {
        if (depth <= 0)
            return this.evaluate();

        if (offset > 0) {
            // detect any repetition and assume a draw is coming (return a 0 draw score)
            //if (this.repetitionHistory.includes(this.boardHash))
            //    return 0;

            // modify the values to skip this position if a mating sequence has already been found and is shorter
            alpha = Math.max(alpha, Number.MIN_SAFE_INTEGER + offset);
            beta = Math.min(beta, Number.MAX_SAFE_INTEGER - offset);
            if (alpha >= beta) {
                return alpha;
            }
        }

        const hashString = this.boardHash.toString();
        if (hashString in this.savedEvaluations) {
            const savedEval = this.savedEvaluations[hashString];
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
                if (offset == 0)
                    this.evalBestMove = this.savedEvaluations[hashString].bestMove;
                return finalScore;
            }
        }

        const validMoves = this.getAllValidMoves(false);
        const sortedMoves = this.predictAndOrderMoves(validMoves);
        if (sortedMoves.length == 0) { // either checkmate or stalemate
            if (this.isInCheck(this.whiteTurn))
                return Number.MIN_SAFE_INTEGER + offset; // checkmate, worst possible move
            else
                return 0; // stalemate, draw
        }

        const startingHash = this.boardHash;
        const oldEnPassant = this.enPassantSquare;
        const oldBlackCanCastle = [...this.blackCanCastle];
        const oldWhiteCanCastle = [...this.whiteCanCastle];
        let bestMoveForThisPosition: EvalMove = { from: -1, to: -1, data: 0 };
        let savingType = SavedEvalTypes.Alpha;
        const length = sortedMoves.length;
        for (let i = 0; i < length; i++) {
            // make the move
            const capture = this.board[sortedMoves[i].move.to];
            this.updateCastleStatus(sortedMoves[i].move.from, sortedMoves[i].move.to);
            this.forceMakeMove(sortedMoves[i].move.from, { index: sortedMoves[i].move.to, data: sortedMoves[i].move.data }, false);
            const deltas = this.boardDelta;
            this.boardHash = this.updateHash(deltas, startingHash, oldEnPassant, oldBlackCanCastle, oldWhiteCanCastle);
            this.boardDelta = [];
            this.whiteTurn = !this.whiteTurn;

            // calculate evaluation (one player's upper bound is the other's lower bound)
            let evaluation = -1 * this.findBestMove(depth - 1, offset + 1, -beta, -alpha);

            // unmake the move
            this.unmakeMove(deltas);
            this.boardHash = startingHash;
            this.enPassantSquare = oldEnPassant;

            if (offset == 0) {
                this.movesFoundThisTurn.push({
                    from: sortedMoves[i].move.from,
                    to: sortedMoves[i].move.to,
                    data: sortedMoves[i].move.data,
                    piece: this.board[sortedMoves[i].move.from],
                    eval: evaluation
                });
            }

            // calc alpha & beta
            if (evaluation >= beta) {
                this.savedEvaluations[hashString] = { totalMoves: 0, depth: depth, bestMove: bestMoveForThisPosition, type: SavedEvalTypes.Beta, eval: beta };
                return beta;
            }
            if (evaluation > alpha) { // best move found
                bestMoveForThisPosition = sortedMoves[i].move;
                alpha = evaluation;
                savingType = SavedEvalTypes.Exact;

                if (offset == 0) {
                    this.evalBestMove = bestMoveForThisPosition;
                }
            }
        }

        this.savedEvaluations[hashString] = { totalMoves: 0, depth: depth, bestMove: bestMoveForThisPosition, type: savingType, eval: alpha };
        return alpha;
    }

    calculateAllPossibleMoves = (depth: number) => {
        if (depth <= 0)
            return 1;

        const hashString = this.boardHash.toString();
        if (hashString in this.savedEvaluations && this.savedEvaluations[hashString].depth == depth)
            return this.savedEvaluations[hashString].totalMoves;

        const validMoves = this.getAllValidMoves(false);
        let totalMoves = 0;

        const startingHash = this.boardHash;
        const oldEnPassant = this.enPassantSquare;
        const oldBlackCanCastle = [...this.blackCanCastle];
        const oldWhiteCanCastle = [...this.whiteCanCastle];
        for (let key in validMoves) {
            const pieceIndex = parseInt(key);
            if (isNaN(pieceIndex))
                continue;
            for (let i = 0; i < validMoves[key].length; i++) {     
                this.updateCastleStatus(pieceIndex, validMoves[key][i].index);
                this.forceMakeMove(pieceIndex, validMoves[key][i], false);
                const deltas = this.boardDelta;
                this.boardHash = this.updateHash(deltas, startingHash, oldEnPassant, oldBlackCanCastle, oldWhiteCanCastle);
                this.boardDelta = [];
                this.whiteTurn = !this.whiteTurn;

                totalMoves += this.calculateAllPossibleMoves(depth - 1);

                this.unmakeMove(deltas);
                this.boardHash = startingHash;
                this.enPassantSquare = oldEnPassant;
            }
        }

        this.savedEvaluations[hashString] = { totalMoves: totalMoves, depth: depth, eval: 0, type: SavedEvalTypes.Exact, bestMove: { from: -1, to: -1, data: 0 } };
        return totalMoves;
    }

    randomBotMove = () => {
        if (this.historicalIndex != 0)
            return;

        const pieceIndex = Math.floor(Math.random() * Object.keys(this.allValidMoves).length);
        const key = parseInt(Object.keys(this.allValidMoves)[pieceIndex]);

        if (isNaN(key))
            return;

        const moveIndex = Math.floor(Math.random() * this.allValidMoves[key].length);
        const move = this.allValidMoves[key][moveIndex];

        if (this.board[key] == Piece.King_W)
            this.whiteKingIndex = move.index;
        else if (this.board[key] == Piece.King_B)
            this.blackKingIndex = move.index;

        this.updateCastleStatus(key, move.index);
        this.forceMakeMove(key, move, true);
    }

    evalBotMove = (depth: number) => {
        if (this.historicalIndex != 0)
            return;

        const startTime = self.performance.now();

        const lastMove = {...this.evalBestMove};
        this.findBestMove(depth, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        if (lastMove.to == this.evalBestMove.to && lastMove.from == this.evalBestMove.from) {
            console.log("Attempting to make the same move: " + lastMove.toString());
            return;
        }

        if (this.board[this.evalBestMove.from] == Piece.King_W)
            this.whiteKingIndex = this.evalBestMove.to;
        else if (this.board[this.evalBestMove.from] == Piece.King_B)
            this.blackKingIndex = this.evalBestMove.to;

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

        // no-op moves
        if (fromIndex == toIndex || movingPiece == Piece.Empty)
            return false;

        // only move correct color pieces on correct turn
        if ((this.whiteTurn && movingPiece < Piece.King_W) || (!this.whiteTurn && movingPiece > Piece.Pawn_B))
            return false;

        const validMoves = this.getAllValidMoves(false);
        if (!(fromIndex in validMoves))
            return false;
        if (!validMoves[fromIndex].some(e => e.index == toIndex))
            return false;

        this.castledThisTurn = this.updateCastleStatus(fromIndex, toIndex);
        this.pieceCapturedThisTurn = this.board[toIndex] != Piece.Empty;
        this.forceMakeMove(fromIndex, { index: toIndex, data: this.whiteTurn ? Piece.Queen_W : Piece.Queen_B }, true); // auto promote to queen when possible
        return true;
    }
}

const engine = new Engine();

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.RetrieveBoard:
            ctx.postMessage({
                command: e.data.command,
                board: engine.board,
                validMoves: engine.unwrapMoves(engine.allValidMoves)
            });
            break;
        case EngineCommands.AttemptMove:
        {
            const result = engine.attemptMove(e.data.fromIndex, e.data.toIndex);
            const inCheck = result ? engine.isInCheck(engine.whiteTurn) : false;
            ctx.postMessage({
                command: e.data.command,
                from: e.data.fromIndex,
                to: e.data.toIndex,
                board: result ? engine.board : [],
                validMoves: engine.unwrapMoves(engine.allValidMoves),
                inCheck: inCheck,
                captured: engine.pieceCapturedThisTurn,
                castled: engine.castledThisTurn
            });
            break;
        }
        case EngineCommands.HistoryGoBack:
            engine.stepBack();
            ctx.postMessage({ command: e.data.command, board: engine.board });
            break;
        case EngineCommands.HistoryGoForward:
            engine.stepForward();
            ctx.postMessage({ command: e.data.command, board: engine.board });
            break;
        case EngineCommands.BotBestMove:
        {
            engine.evalBotMove(6);
            const inCheck = engine.isInCheck(engine.whiteTurn);
            ctx.postMessage({
                command: e.data.command,
                from: engine.evalBestMove.from,
                to: engine.evalBestMove.to,
                timeTaken: engine.timeTakenLastTurn,
                board: engine.board,
                validMoves: engine.unwrapMoves(engine.allValidMoves),
                inCheck: inCheck,
                captured: engine.pieceCapturedThisTurn,
                castled: engine.castledThisTurn
            });
            break;
        }
        default:
            break;
    }
});