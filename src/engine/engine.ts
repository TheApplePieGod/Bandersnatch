import bigInt from "big-integer";
import { Piece, Value } from "../definitions";

interface HistoricalBoard {
    board: number[];
    whiteTurn: boolean;
    whiteKingIndex: number;
    blackKingIndex: number;
    whiteCanCastle: boolean[];
    blackCanCastle: boolean[];
}

interface BoardDelta {
    index: number;
    piece: number;
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

interface EvaluationData {
    totalMoves: number;
    eval: number;
    bestMove: EvalMove;
    depth: number;
}

export class Engine {
    boardSize = 8;
    board: number[] = [];
    boardDelta: BoardDelta[] = [];
    boardHash: bigInt.BigNumber = bigInt(0);

    zobristHashTable: bigInt.BigNumber[][] = [];
    savedEvaluations: Record<string, EvaluationData> = {};
    evalBestMove: EvalMove = { from: -1, to: -1, data: 0 };

    moveCount = 0;
    historicalBoards: HistoricalBoard[] = [];
    historicalIndex = 0;
    whiteTurn = true;
    whiteCanCastle = [true, true]; // kingside, queenside
    blackCanCastle = [true, true];
    whiteKingIndex = -1;
    blackKingIndex = -1;
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
        //startingFEN = "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8";
        //startingFEN = "rn2kbnr/pQ2p1pp/2p2p2/4q3/6P1/P1K5/2P5/2B5 w kq - 0 1";
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
                this.zobristHashTable[i].push(bigInt.randBetween(0, maxVal));
            }
        }

        // castle values
        for (let i = 0; i < 4; i++) {
            this.zobristHashTable.push([]);
            for (let j = 0; j < 2; j++) {
                this.zobristHashTable[i + 64].push(bigInt.randBetween(0, maxVal));
            }
        }

        // turn
        this.zobristHashTable.push([bigInt.randBetween(0, maxVal), bigInt.randBetween(0, maxVal)]);

        this.boardHash = this.hashBoard();
    }

    createHistoricalBoard = () => {
        return ({
            board:  [...this.board],
            whiteTurn: this.whiteTurn,
            whiteKingIndex: this.whiteKingIndex,
            blackKingIndex: this.blackKingIndex,
            whiteCanCastle: [...this.whiteCanCastle],
            blackCanCastle: [...this.blackCanCastle]
        });
    }

    useHistoricalBoard = (historicalBoard: HistoricalBoard) => {
        this.board = [...historicalBoard.board];
        this.whiteTurn = historicalBoard.whiteTurn;
        this.whiteKingIndex = historicalBoard.whiteKingIndex;
        this.blackKingIndex = historicalBoard.blackKingIndex;
        this.whiteCanCastle = [...historicalBoard.whiteCanCastle];
        this.blackCanCastle = [...historicalBoard.blackCanCastle];
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
        let hash: bigInt.BigNumber = bigInt(0);
        
        // board values
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] != Piece.Empty) {
                const j = this.board[i] - 1;
                hash = hash.xor(this.zobristHashTable[i][j]);
            }
        }

        // castle values
        hash = hash.xor(this.zobristHashTable[64][(this.whiteCanCastle[0] ? 0 : 1)]);
        hash = hash.xor(this.zobristHashTable[65][(this.whiteCanCastle[1] ? 0 : 1)]);
        hash = hash.xor(this.zobristHashTable[66][(this.blackCanCastle[0] ? 0 : 1)]);
        hash = hash.xor(this.zobristHashTable[67][(this.blackCanCastle[1] ? 0 : 1)]);

        // turn
        hash = hash.xor(this.zobristHashTable[68][(this.whiteTurn ? 0 : 1)]);

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
                    board[boardIndex] = this.fenToPieceDict[terms[t]];
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

    traceValidSquares = (index: number, slopeX: number, slopeY: number, validPieces: number[]) => {
        let valid: number[] = [];
        let currentIndex = index;
        const xyMax = this.boardSize - 1;

        let obstructed = false;
        while (currentIndex >= 0 && currentIndex < this.board.length) {
            if (currentIndex != index) {
                if (!obstructed && validPieces.includes(this.board[currentIndex])) {
                    valid.push(currentIndex);
                    obstructed = this.board[currentIndex] != Piece.Empty;
                }
                else
                    break;
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

        return valid;
    }

    getValidSquares = (index: number, piece: number, attackOnly: boolean) => {
        let valid: number[] = [];
        const x = index % this.boardSize;
        const y = Math.floor(index / this.boardSize);
        const xyMax = this.boardSize - 1;

        // valid pieces which can be captured (include king for calculating checks)
        let validPieces: number[] = [];
        if (piece < 7) { // black
            validPieces = [ Piece.Empty, Piece.King_W, Piece.Queen_W, Piece.Rook_W, Piece.Bishop_W, Piece.Knight_W, Piece.Pawn_W ];
        } else { // white
            validPieces = [ Piece.Empty, Piece.King_B, Piece.Queen_B, Piece.Rook_B, Piece.Bishop_B, Piece.Knight_B, Piece.Pawn_B ];
        }

        switch (piece) {
            case Piece.Rook_W:
            case Piece.Rook_B:
                valid = valid.concat(this.traceValidSquares(index, 1, 0, validPieces)); // right
                valid = valid.concat(this.traceValidSquares(index, -1, 0, validPieces)); // left
                valid = valid.concat(this.traceValidSquares(index, 0, 1, validPieces)); // down
                valid = valid.concat(this.traceValidSquares(index, 0, -1, validPieces)); // up
                break;
            case Piece.Queen_W:
            case Piece.Queen_B:
                valid = valid.concat(this.traceValidSquares(index, 1, 0, validPieces)); // right
                valid = valid.concat(this.traceValidSquares(index, -1, 0, validPieces)); // left
                valid = valid.concat(this.traceValidSquares(index, 0, 1, validPieces)); // down
                valid = valid.concat(this.traceValidSquares(index, 0, -1, validPieces)); // up
                valid = valid.concat(this.traceValidSquares(index, 1, -1, validPieces)); // up right
                valid = valid.concat(this.traceValidSquares(index, -1, -1, validPieces)); // up left
                valid = valid.concat(this.traceValidSquares(index, 1, 1, validPieces)); // down right
                valid = valid.concat(this.traceValidSquares(index, -1, 1, validPieces)); // down left
                break;
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                valid = valid.concat(this.traceValidSquares(index, 1, -1, validPieces)); // up right
                valid = valid.concat(this.traceValidSquares(index, -1, -1, validPieces)); // up left
                valid = valid.concat(this.traceValidSquares(index, 1, 1, validPieces)); // down right
                valid = valid.concat(this.traceValidSquares(index, -1, 1, validPieces)); // down left
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
                        valid.push(upOne);
                    if (y == 6 && this.board[upTwo] == Piece.Empty && this.board[upOne] == Piece.Empty)
                        valid.push(upTwo);
                }
                if (x != 0 && upLeft >= 0 && (this.board[upLeft] != Piece.Empty || attackOnly) && validPieces.includes(this.board[upLeft]))
                    valid.push(upLeft);
                if (x != xyMax && upRight >= 0 && (this.board[upRight] != Piece.Empty || attackOnly) && validPieces.includes(this.board[upRight]))
                    valid.push(upRight);
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
                        valid.push(downOne);
                    if (y == 1 && this.board[downTwo] == Piece.Empty && this.board[downOne] == Piece.Empty)
                        valid.push(downTwo);
                }
                if (x != 0 && downLeft < this.board.length && (this.board[downLeft] != Piece.Empty || attackOnly) && validPieces.includes(this.board[downLeft]))
                    valid.push(downLeft);
                if (x != xyMax && downRight < this.board.length && (this.board[downRight] != Piece.Empty || attackOnly) && validPieces.includes(this.board[downRight]))
                    valid.push(downRight);
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

                if (upOne >= 0 && validPieces.includes(this.board[upOne]))
                    valid.push(upOne);
                if (downOne < this.board.length && validPieces.includes(this.board[downOne]))
                    valid.push(downOne);
                if (x != 0 && leftOne >= 0 && validPieces.includes(this.board[leftOne]))
                    valid.push(leftOne);
                if (x != xyMax && rightOne < this.board.length && validPieces.includes(this.board[rightOne]))
                    valid.push(rightOne);

                if (x != 0 && upLeft >= 0 && validPieces.includes(this.board[upLeft]))
                    valid.push(upLeft);
                if (x != xyMax && upRight >= 0 && validPieces.includes(this.board[upRight]))
                    valid.push(upRight);
                if (x != 0 && downLeft < this.board.length && validPieces.includes(this.board[downLeft]))
                    valid.push(downLeft);
                if (x != xyMax && downRight < this.board.length && validPieces.includes(this.board[downRight]))
                    valid.push(downRight);
                
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

                if (x >= 2 && y >= 1 && validPieces.includes(this.board[upLeftOne]))
                    valid.push(upLeftOne);
                if (x >= 1 && y >= 2 && validPieces.includes(this.board[upLeftTwo]))
                    valid.push(upLeftTwo);
                if (x <= xyMax - 1 && y >= 2 && validPieces.includes(this.board[upRightOne]))
                    valid.push(upRightOne);
                if (x <= xyMax - 2 && y >= 1 && validPieces.includes(this.board[upRightTwo]))
                    valid.push(upRightTwo);
                
                if (x >= 2 && y <= xyMax - 1 && validPieces.includes(this.board[bottomLeftOne]))
                    valid.push(bottomLeftOne);
                if (x >= 1 && y <= xyMax - 2 && validPieces.includes(this.board[bottomLeftTwo]))
                    valid.push(bottomLeftTwo);
                if (x <= xyMax - 1 && y <= xyMax - 2 && validPieces.includes(this.board[bottomRightOne]))
                    valid.push(bottomRightOne);
                if (x <= xyMax - 2 && y <= xyMax - 1 && validPieces.includes(this.board[bottomRightTwo]))
                    valid.push(bottomRightTwo);
                
                break;
            }
            default:
                break;
        }

        return valid;
    }

    getAttackedSquares = (white: boolean) => {
        let attackedSquares: number[] = [];

        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] != Piece.Empty)
                if ((white && this.board[i] < 7) || (!white && this.board[i] > 6))
                    attackedSquares = attackedSquares.concat(this.getValidSquares(i, this.board[i], true));
        }

        return attackedSquares;
    }

    getValidCastleSquares = () => {
        let validCastleSquares: Record<number, MoveInfo[]> = {};
        const attackedSquares = this.getAttackedSquares(this.whiteTurn);

        if (this.whiteTurn) {
            if (this.whiteCanCastle[0] && this.board[63] == Piece.Rook_W && this.traceValidSquares(60, 1, 0, [ Piece.Empty ]).length == 2) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(61) && !attackedSquares.includes(62)) {
                    if (60 in validCastleSquares)
                        validCastleSquares[60].push({ index: 62, data: 0 });
                    else
                        validCastleSquares[60] = [{ index: 62, data: 0 }];
                }
            }
            if (this.whiteCanCastle[1] && this.board[56] == Piece.Rook_W && this.traceValidSquares(60, -1, 0, [ Piece.Empty ]).length == 3) {
                if (!attackedSquares.includes(60) && !attackedSquares.includes(59) && !attackedSquares.includes(58)) {
                    if (60 in validCastleSquares)
                        validCastleSquares[60].push({ index: 58, data: 0 });
                    else
                        validCastleSquares[60] = [{ index: 58, data: 0 }];
                }
            }
        } else {
            if (this.blackCanCastle[0] && this.board[7] == Piece.Rook_B && this.traceValidSquares(4, 1, 0, [ Piece.Empty ]).length == 2) {
                if (!attackedSquares.includes(4) && !attackedSquares.includes(5) && !attackedSquares.includes(6)) {
                    if (4 in validCastleSquares)
                        validCastleSquares[4].push({ index: 6, data: 0 });
                    else
                        validCastleSquares[4] = [{ index: 6, data: 0 }];
                }
            }
            if (this.blackCanCastle[1] && this.board[0] == Piece.Rook_B && this.traceValidSquares(4, -1, 0, [ Piece.Empty ]).length == 3) {
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
        const attacked = this.getAttackedSquares(white);
        return ((white && attacked.includes(this.whiteKingIndex)) || (!white && attacked.includes(this.blackKingIndex)));
    }

    getAllValidMoves = (bothSides: boolean) => {
        let allValid: Record<number, MoveInfo[]> = {};

        const validCastleSquares = this.getValidCastleSquares();
        for (let key in validCastleSquares) {
            allValid[key] = validCastleSquares[key];
        }

        for (let i = 0; i < this.board.length; i++) {
            const movingPiece = this.board[i];

            if (movingPiece == Piece.Empty)
                continue;

            // only consider same color pieces
            if (!bothSides && ((this.whiteTurn && movingPiece < Piece.King_W) || (!this.whiteTurn && movingPiece > Piece.Pawn_B)))
                continue;

            const valid = this.getValidSquares(i, movingPiece, false);
            this.board[i] = Piece.Empty;
            for (let j = 0; j < valid.length; j++) {
                const pieceBackup = this.board[valid[j]];
                this.board[valid[j]] = movingPiece;
                const attacked = this.getAttackedSquares(this.whiteTurn);
                this.board[valid[j]] = pieceBackup;
                if (movingPiece == Piece.King_W || movingPiece == Piece.King_B) {
                    if (attacked.includes(valid[j]))
                        continue;
                }
                else if ((this.whiteTurn && attacked.includes(this.whiteKingIndex)) || (!this.whiteTurn && attacked.includes(this.blackKingIndex)))
                    continue;

                // add more moves to account for promoting to various pieces
                const y = Math.floor(valid[j] / this.boardSize);
                if (movingPiece == Piece.Pawn_W && y == 0) {
                    if (i in allValid)
                        allValid[i].push({ index: valid[j], data: Piece.Queen_W });
                    else
                        allValid[i] = [{ index: valid[j], data: Piece.Queen_W }];
                    allValid[i].push({ index: valid[j], data: Piece.Bishop_W });
                    allValid[i].push({ index: valid[j], data: Piece.Knight_W });
                    allValid[i].push({ index: valid[j], data: Piece.Rook_W });
                } else if (movingPiece == Piece.Pawn_B && y == 7) {
                    if (i in allValid)
                        allValid[i].push({ index: valid[j], data: Piece.Queen_B });
                    else
                        allValid[i] = [{ index: valid[j], data: Piece.Queen_B }];
                    allValid[i].push({ index: valid[j], data: Piece.Bishop_B });
                    allValid[i].push({ index: valid[j], data: Piece.Knight_B });
                    allValid[i].push({ index: valid[j], data: Piece.Rook_B });
                } else {
                    if (i in allValid)
                        allValid[i].push({ index: valid[j], data: 0 });
                    else
                        allValid[i] = [{ index: valid[j], data: 0 }];
                }
            }
            this.board[i] = movingPiece;
        }

        return allValid;
    }

    finishTurn = () => {
        this.whiteTurn = !this.whiteTurn;
        this.historicalBoards.push(this.createHistoricalBoard());
        this.boardHash = this.hashBoard();
        this.boardDelta = [];
        this.allValidMoves = this.getAllValidMoves(false);
        this.moveCount++;
    }

    forceMakeMove = (fromIndex: number, move: MoveInfo, finishTurn: boolean) => {
        const toIndex = move.index;

        this.boardDelta.push({ index: toIndex, piece: this.board[toIndex], canCastle: [] });
        this.boardDelta.push({ index: fromIndex, piece: this.board[fromIndex], canCastle: [] });
        this.board[toIndex] = this.board[fromIndex];
        this.board[fromIndex] = Piece.Empty;

        // promotion check
        const y = Math.floor(toIndex / this.boardSize);
        if (this.board[toIndex] == Piece.Pawn_W && y == 0)
            this.board[toIndex] = move.data; 
        else if (this.board[toIndex] == Piece.Pawn_B && y == 7)
            this.board[toIndex] = move.data; 

        if (finishTurn)
            this.finishTurn();
    }

    unmakeMove = (deltas: BoardDelta[]) => {
        this.whiteTurn = !this.whiteTurn;
        for (let i = 0; i < deltas.length; i++) {
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
        
        if (movingPiece == Piece.King_W) {
            if (this.whiteCanCastle[0] && toIndex == 62) {
                this.boardDelta.push({ index: 63, piece: this.board[63], canCastle: [...this.whiteCanCastle] });
                this.boardDelta.push({ index: 61, piece: this.board[61], canCastle: [...this.whiteCanCastle] });
                this.board[63] = Piece.Empty;
                this.board[61] = Piece.Rook_W;
            } else if (this.whiteCanCastle[1] && toIndex == 58) {
                this.boardDelta.push({ index: 56, piece: this.board[56], canCastle: [...this.whiteCanCastle] });
                this.boardDelta.push({ index: 59, piece: this.board[59], canCastle: [...this.whiteCanCastle] });
                this.board[56] = Piece.Empty;
                this.board[59] = Piece.Rook_W;
            } else {
                this.boardDelta.push({ index: fromIndex, piece: Piece.King_W, canCastle: [...this.whiteCanCastle] });
            }

            this.whiteKingIndex = toIndex;
            this.whiteCanCastle = [false, false];
        }
        else if (movingPiece == Piece.King_B) {
            if (this.blackCanCastle[0] && toIndex == 6) {
                this.boardDelta.push({ index: 7, piece: this.board[7], canCastle: [...this.blackCanCastle] });
                this.boardDelta.push({ index: 5, piece: this.board[5], canCastle: [...this.blackCanCastle] });
                this.board[7] = Piece.Empty;
                this.board[5] = Piece.Rook_B;
            } else if (this.blackCanCastle[1] && toIndex == 2) {
                this.boardDelta.push({ index: 0, piece: this.board[0], canCastle: [...this.blackCanCastle] });
                this.boardDelta.push({ index: 3, piece: this.board[3], canCastle: [...this.blackCanCastle] });
                this.board[0] = Piece.Empty;
                this.board[3] = Piece.Rook_B;
            } else {
                this.boardDelta.push({ index: fromIndex, piece: Piece.King_B, canCastle: [...this.blackCanCastle] });
            }

            this.blackKingIndex = toIndex;
            this.blackCanCastle = [false, false];
        }
        else if (movingPiece == Piece.Rook_W && fromIndex == 56) {
            this.boardDelta.push({ index: fromIndex, piece: movingPiece, canCastle: [...this.whiteCanCastle] });
            this.whiteCanCastle[1] = false; // queenside
        }
        else if (movingPiece == Piece.Rook_W && fromIndex == 63) {
            this.boardDelta.push({ index: fromIndex, piece: movingPiece, canCastle: [...this.whiteCanCastle] });
            this.whiteCanCastle[0] = false; // kingside
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 0) {
            this.boardDelta.push({ index: fromIndex, piece: movingPiece, canCastle: [...this.blackCanCastle] });
            this.blackCanCastle[1] = false; // queenside
        }
        else if (movingPiece == Piece.Rook_B && fromIndex == 7) {
            this.boardDelta.push({ index: fromIndex, piece: movingPiece, canCastle: [...this.blackCanCastle] });
            this.blackCanCastle[0] = false; // kingside
        }
    }    

    countTotalMoves = (moveList: Record<number, number[]>) => {
        let count = 0;
        for (let key in moveList) {
            count += moveList[key].length;
        }
        return count;
    }

    updateHash = (delta: BoardDelta[], hash: bigInt.BigNumber) => {
        let newHash = bigInt(0).add(hash);
        for (let i = 0; i < delta.length; i++) {
            const pos = delta[i].index;
            const piece = delta[i].piece - 1;
            const newPiece = this.board[pos] - 1;
            if (piece >= 0)
                newHash = newHash.xor(this.zobristHashTable[pos][piece]);
            if (newPiece >= 0)
                newHash = newHash.xor(this.zobristHashTable[pos][newPiece]);
        }
        newHash = newHash.xor(this.zobristHashTable[68][(this.whiteTurn ? 0 : 1)]);
        newHash = newHash.xor(this.zobristHashTable[68][(this.whiteTurn ? 1 : 0)]);
        return newHash;
    }

    predictAndOrderMoves = (moves: Record<number, MoveInfo[]>) => {
        let finalMoves: { move: EvalMove, score: number }[] = [];
        const attacked: number[] = [];// this.getAttackedSquares(this.whiteTurn);

        for (let key in moves) {
            for (let i = 0; i < moves[key].length; i++) {
                const pieceIndex = parseInt(key);
                if (isNaN(pieceIndex))
                    continue;

                let score = 0;
                const movingPiece = this.board[pieceIndex];
                const capturingPiece = this.board[moves[key][i].index];
                const promoting = moves[key][i].data;

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

                finalMoves.push({ move: { from: pieceIndex, to: moves[key][i].index, data: moves[key][i].data }, score: score });
            }
        }

        finalMoves.sort((a, b) => {
            return b.score - a.score;
        });
        return finalMoves;
    }

    evaluate = () => {
        const whiteMaterial = this.countMaterial(true);
        const blackMaterial = this.countMaterial(false);

        let whiteEval = whiteMaterial;
        let blackEval = blackMaterial;
        
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

        for (let i = 0; i < this.board.length; i++) {
            const movingPiece = this.board[i];
            if (movingPiece == Piece.Empty)
                continue;

            // only count pieces of specified color
            if ((white && movingPiece < Piece.King_W) || (!white && movingPiece > Piece.Pawn_B))
                continue;

            value += this.getPieceValue(movingPiece);
        }

        return value;
    }

    // lower bound: alpha, upper bound: beta
    findBestMove = (depth: number, offset: number, alpha: number, beta: number) => {
        if (depth <= 0)
            return this.evaluate();

        const hashString = this.boardHash.toString();
        if (hashString in this.savedEvaluations && this.savedEvaluations[hashString].depth >= depth) {
            if (offset == 0)
                this.evalBestMove = this.savedEvaluations[hashString].bestMove;
            return this.savedEvaluations[hashString].eval;
        }

        const validMoves = this.getAllValidMoves(false);
        if (Object.keys(validMoves).length == 0) { // either checkmate or stalemate
            if (this.isInCheck(this.whiteTurn))
                return Number.MIN_SAFE_INTEGER; // checkmate, worst possible move
            else
                return 0; // stalemate, draw
        }
        const sortedMoves = this.predictAndOrderMoves(validMoves);

        const startingHash = this.boardHash;
        let bestMoveForThisPosition: EvalMove = { from: -1, to: -1, data: 0 };
        for (let i = 0; i < sortedMoves.length; i++) {
            // make the move
            this.updateCastleStatus(sortedMoves[i].move.from, sortedMoves[i].move.to);
            this.forceMakeMove(sortedMoves[i].move.from, { index: sortedMoves[i].move.to, data: sortedMoves[i].move.data }, false);
            const deltas = this.boardDelta;
            this.boardHash = this.updateHash(deltas, startingHash);
            this.boardDelta = [];
            this.whiteTurn = !this.whiteTurn;

            // calculate evaluation (one player's upper bound is the other's lower bound)
            let evaluation = -1 * this.findBestMove(depth - 1, offset + 1, -beta, -alpha);

            // unmake the move
            this.unmakeMove(deltas);
            this.boardHash = startingHash;

            // calc alpha & beta
            if (evaluation >= beta)
                return beta;
            if (evaluation > alpha) { // best move found
                bestMoveForThisPosition = sortedMoves[i].move;
                alpha = evaluation;

                if (offset == 0) {
                    this.evalBestMove = bestMoveForThisPosition;
                }
            }
        }

        this.savedEvaluations[hashString] = { totalMoves: 0, depth: depth, bestMove: bestMoveForThisPosition, eval: alpha };
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
        for (let key in validMoves) {
            for (let i = 0; i < validMoves[key].length; i++) {
                const pieceIndex = parseInt(key);
                if (isNaN(pieceIndex))
                    continue;
                    
                this.updateCastleStatus(pieceIndex, validMoves[key][i].index);
                this.forceMakeMove(pieceIndex, validMoves[key][i], false);
                const deltas = this.boardDelta;
                this.boardHash = this.updateHash(deltas, startingHash);
                this.boardDelta = [];
                this.whiteTurn = !this.whiteTurn;
                totalMoves += this.calculateAllPossibleMoves(depth - 1);
                this.unmakeMove(deltas);
                this.boardHash = startingHash;
            }
        }

        this.savedEvaluations[hashString] = { totalMoves: totalMoves, depth: depth, eval: 0, bestMove: { from: -1, to: -1, data: 0 } };
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

    evalBotMove = () => {
        if (this.historicalIndex != 0)
            return;

        this.findBestMove(5, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);

        if (this.board[this.evalBestMove.from] == Piece.King_W)
            this.whiteKingIndex = this.evalBestMove.to;
        else if (this.board[this.evalBestMove.from] == Piece.King_B)
            this.blackKingIndex = this.evalBestMove.to;

        console.log(this.evalBestMove.from, this.evalBestMove.to);
        this.updateCastleStatus(this.evalBestMove.from, this.evalBestMove.to);
        this.forceMakeMove(this.evalBestMove.from, { index: this.evalBestMove.to, data: this.evalBestMove.data }, true);
    }

    attemptMove = (fromIndex: number, toIndex: number) => {
        const movingPiece = this.board[fromIndex];

        // do not allow moves when looking back
        if (this.historicalIndex != 0)
            return;

        // no-op moves
        if (fromIndex == toIndex || movingPiece == Piece.Empty)
            return;

        // only move correct color pieces on correct turn
        if ((this.whiteTurn && movingPiece < Piece.King_W) || (!this.whiteTurn && movingPiece > Piece.Pawn_B))
            return;

        const validMoves = this.getAllValidMoves(false);
        if (!(fromIndex in validMoves))
            return;
        if (!validMoves[fromIndex].some(e => e.index == toIndex))
            return;

        this.updateCastleStatus(fromIndex, toIndex);
        this.forceMakeMove(fromIndex, { index: toIndex, data: Piece.Queen_W }, true); // auto promote to queen when possible

        //if (this.moveCount == 1)
        //    this.forceMakeMove(11, { index: 27, data: Piece.Queen_W }, true); // d5
        //else
            this.evalBotMove();
    }
}