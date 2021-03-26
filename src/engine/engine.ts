import { Piece } from "../definitions";

export class Engine {
    boardSize = 8;
    board: number[] = [];
    historicalBoards: number[][] = [];
    historicalIndex = 0;
    whiteTurn = true;
    whiteCanCastle = [true, true]; // kingside, queenside
    blackCanCastle = [true, true];
    whiteKingIndex = -1;
    blackKingIndex = -1;
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
        startingFEN = "r3k2r/pppqp1pp/2b3p1/2n5/8/1p2bQ2/PPPPPPPP/RNB1KBNR w KQkq - 0 1";
        this.board = this.parseFEN(startingFEN);
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] == Piece.King_W)
                this.whiteKingIndex = i;
            else if (this.board[i] == Piece.King_B)
                this.blackKingIndex = i;
        }
        this.historicalBoards.push([...this.board]);
    }

    stepBack = () => {
        if (Math.abs(this.historicalIndex) < this.historicalBoards.length - 1) {
            this.historicalIndex--;
            this.board = [...this.historicalBoards[this.historicalBoards.length - 1 + this.historicalIndex]];
        }
    }

    stepForward = () => {
        if (this.historicalIndex < 0) {
            this.historicalIndex++;
            this.board = [...this.historicalBoards[this.historicalBoards.length - 1 + this.historicalIndex]];
        }
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
            case Piece.Pawn_W:
            {
                const upOne = index - (this.boardSize);
                const upTwo = index - (this.boardSize * 2);
                const upLeft = upOne - 1;
                const upRight = upOne + 1;
                if (!attackOnly) {
                    if (upOne > 0 && this.board[upOne] == Piece.Empty)
                        valid.push(upOne);
                    if (y == 6 && this.board[upTwo] == Piece.Empty && this.board[upOne] == Piece.Empty)
                        valid.push(upTwo);
                }
                if (x != 0 && upLeft > 0 && (this.board[upLeft] != Piece.Empty || attackOnly) && validPieces.includes(this.board[upLeft]))
                    valid.push(upLeft);
                if (x != xyMax && upRight > 0 && (this.board[upRight] != Piece.Empty || attackOnly) && validPieces.includes(this.board[upRight]))
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

                if (upOne > 0 && validPieces.includes(this.board[upOne]))
                    valid.push(upOne);
                if (downOne < this.board.length && validPieces.includes(this.board[downOne]))
                    valid.push(downOne);
                if (x != 0 && leftOne > 0 && validPieces.includes(this.board[leftOne]))
                    valid.push(leftOne);
                if (x != xyMax && rightOne < this.board.length && validPieces.includes(this.board[rightOne]))
                    valid.push(rightOne);

                if (x != 0 && upLeft > 0 && validPieces.includes(this.board[upLeft]))
                    valid.push(upLeft);
                if (x != xyMax && upRight > 0 && validPieces.includes(this.board[upRight]))
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


        // castling --------------------------------------------
        let justCastled = 0;
        if (movingPiece == Piece.King_W) { // white castling
            if (this.whiteCanCastle[0] && toIndex == 62) { // king side
                if (this.traceValidSquares(fromIndex, 1, 0, [ Piece.Empty ]).length == 2) { // nothing blocking the way on the king side
                    this.board[63] = Piece.Empty;
                    this.board[62] = Piece.King_W;
                    this.board[61] = Piece.Rook_W;
                    this.board[60] = Piece.Empty;
                    justCastled = 1;
                }
            } else if (this.whiteCanCastle[1] && toIndex == 58) { // queen side
                if (this.traceValidSquares(fromIndex, -1, 0, [ Piece.Empty ]).length == 3) { // nothing blocking the way on the queen side
                    this.board[56] = Piece.Empty;
                    this.board[57] = Piece.Empty;
                    this.board[58] = Piece.King_W;
                    this.board[59] = Piece.Rook_W;
                    this.board[60] = Piece.Empty;
                    justCastled = 2;
                }
            }
        } else if (movingPiece == Piece.King_B) { // black castling
            if (this.blackCanCastle[0] && toIndex == 6) { // king side
                if (this.traceValidSquares(fromIndex, 1, 0, [ Piece.Empty ]).length == 2) { // nothing blocking the way on the king side
                    this.board[7] = Piece.Empty;
                    this.board[6] = Piece.King_B;
                    this.board[5] = Piece.Rook_B;
                    this.board[4] = Piece.Empty;
                    justCastled = 1;
                }
            } else if (this.blackCanCastle[1] && toIndex == 2) { // queen side
                if (this.traceValidSquares(fromIndex, -1, 0, [ Piece.Empty ]).length == 3) { // nothing blocking the way on the queen side
                    this.board[0] = Piece.Empty;
                    this.board[1] = Piece.Empty;
                    this.board[2] = Piece.King_B;
                    this.board[3] = Piece.Rook_B;
                    this.board[4] = Piece.Empty;
                    justCastled = 2;
                }
            }
        }
        // ---------------------------------------------------------

        let validSquares = this.getValidSquares(fromIndex, movingPiece, false);
        if (!validSquares.includes(toIndex) && !justCastled)
            return;
        
        // update king indexes & castling status
        const whiteKingIndexBackup = this.whiteKingIndex;
        const blackKingIndexBackup = this.blackKingIndex;
        if (movingPiece == Piece.King_W) {
            this.whiteKingIndex = toIndex;
            this.whiteCanCastle = [false, false];
        }
        else if (movingPiece == Piece.King_B) {
            this.blackKingIndex = toIndex;
            this.blackCanCastle = [false, false];
        }
        if (movingPiece == Piece.Rook_W && fromIndex == 56)
            this.whiteCanCastle[1] = false; // queenside
        else if (movingPiece == Piece.Rook_W && fromIndex == 63)
            this.whiteCanCastle[0] = false; // kingside
        else if (movingPiece == Piece.Rook_B && fromIndex == 0)
            this.blackCanCastle[1] = false; // queenside
        else if (movingPiece == Piece.Rook_B && fromIndex == 7)
            this.blackCanCastle[0] = false; // kingside
        // ---------------------------------------------------------

        const toPieceBackup = this.board[toIndex];
        if (justCastled == 0) {
            this.board[toIndex] = this.board[fromIndex];
            this.board[fromIndex] = Piece.Empty;
        }

        let attackedSquares: number[] = [];
        for (let i = 0; i < this.board.length; i++) {
            if (this.board[i] != Piece.Empty)
                if ((this.whiteTurn && this.board[i] < 7) || (!this.whiteTurn && this.board[i] > 6))
                    attackedSquares = attackedSquares.concat(this.getValidSquares(i, this.board[i], true));
        }
        
        // check for attacked squares to verify if the castle was valid
        if (this.whiteTurn) {
            if (justCastled == 1) { // king side
                if (attackedSquares.includes(60) || attackedSquares.includes(61) || attackedSquares.includes(62)) { // cant castle because check so revert
                    this.whiteCanCastle[0] = true;
                    this.whiteKingIndex = whiteKingIndexBackup;
                    this.board[63] = Piece.Rook_W;
                    this.board[62] = Piece.Empty;
                    this.board[61] = Piece.Empty;
                    this.board[60] = Piece.King_W;
                    return;
                }
            } else if (justCastled == 2) { // queen side
                if (attackedSquares.includes(60) || attackedSquares.includes(59) || attackedSquares.includes(58)) { // cant castle because check so revert
                    this.whiteCanCastle[1] = true;
                    this.whiteKingIndex = whiteKingIndexBackup;
                    this.board[56] = Piece.Rook_W;
                    this.board[57] = Piece.Empty;
                    this.board[58] = Piece.Empty;
                    this.board[59] = Piece.Empty;
                    this.board[60] = Piece.King_W;
                    return;
                }
            }
        } else if (!this.whiteTurn) {
            if (justCastled == 1) { // king side
                if (attackedSquares.includes(4) || attackedSquares.includes(5) || attackedSquares.includes(6)) { // cant castle because check so revert
                    this.blackCanCastle[0] = true;
                    this.blackKingIndex = blackKingIndexBackup;
                    this.board[7] = Piece.Rook_B;
                    this.board[6] = Piece.Empty;
                    this.board[5] = Piece.Empty;
                    this.board[4] = Piece.King_B;
                    return;
                }
            } else if (justCastled == 2) { // queen side
                if (attackedSquares.includes(4) || attackedSquares.includes(3) || attackedSquares.includes(2)) { // cant castle because check so revert
                    this.blackCanCastle[1] = true;
                    this.blackKingIndex = blackKingIndexBackup;
                    this.board[0] = Piece.Rook_B;
                    this.board[1] = Piece.Empty;
                    this.board[2] = Piece.Empty;
                    this.board[3] = Piece.Empty;
                    this.board[4] = Piece.King_B;
                    return;
                }
            }
        }
        // ---------------------------------------------------------

        // check if the position creates a check, if so, revert the position
        let check = false;
        const blackKingAttacked = attackedSquares.includes(this.blackKingIndex);
        const whiteKingAttacked = attackedSquares.includes(this.whiteKingIndex);
        if (this.whiteTurn && whiteKingAttacked) { // invalid move so revert
            this.board[toIndex] = toPieceBackup;
            this.board[fromIndex] = movingPiece;
            this.whiteKingIndex = whiteKingIndexBackup;
            return;
        }
        else if (this.whiteTurn && blackKingAttacked)
            check = true;
        else if (!this.whiteTurn && blackKingAttacked) { // invalid move so revert
            this.board[toIndex] = toPieceBackup;
            this.board[fromIndex] = movingPiece;
            this.blackKingIndex = blackKingIndexBackup;
            return;
        }
        else if (!this.whiteTurn && whiteKingAttacked)
            check = true;
        else
            check = false;
        // ---------------------------------------------------------
        
        console.log(check);
        this.whiteTurn = !this.whiteTurn;
        this.historicalBoards.push([...this.board]);
    }
}