import bigInt from "big-integer";
import { bishopSquareTable, knightSquareTable, pawnSquareTable, Piece, queenSquareTable, rookSquareTable, Value, getPieceName, EvalMove, EngineCommands, kingMiddleGameSquareTable, EvalCommands, HistoricalBoard, DebugMoveOutput, notationToIndex, indexToNotation, getPieceNameShort } from "../definitions";
import { openings } from "./openings";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

let wasm: any = null;
let memory: any = null;

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

export class WasmEngine {
    initialized = false;
    wasm_engine: any = null;

    constructor() {
        
    }

    board = () => {
        if (!this.initialized) return undefined;

        const board_ptr = this.wasm_engine.board_ptr();
        const board = new Uint8Array(memory.buffer, board_ptr, 64);

        return board;
    }

    valid_moves = () => {
        if (!this.initialized) return undefined;

        const moves_ptr = this.wasm_engine.valid_moves_ptr();
        const moves_len = this.wasm_engine.valid_moves_len();
        const valid_move_data = new Int32Array(memory.buffer, moves_ptr, moves_len * 4);

        let valid_moves: EvalMove[] = [];
        for (let i = 0; i < valid_move_data.length; i += 4) {
            let move: EvalMove = {
                from: valid_move_data[i],
                to: valid_move_data[i + 1],
                data: valid_move_data[i + 2],
                score: valid_move_data[i + 3],
            }
            valid_moves.push(move);
        }

        return valid_moves;
    }

    piece_locations = () => {
        let piece_list: number[] = [];

        if (!this.initialized) return piece_list;

        for (let i = 0; i <= Piece.Pawn_W; i++) {
            piece_list.push(
                this.wasm_engine.piece_locations(i)
            );
        }
        return piece_list;
    }

    white_turn = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.white_turn();
    }

    in_check = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.in_check();
    }

    piece_captured_this_turn = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.piece_captured_this_turn();
    }

    castled_this_turn = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.castled_this_turn();
    }

    check_for_draw = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.check_for_draw();
    }

    calculate_all_possible_moves = (depth: number) => {
        if (!this.initialized) return 0;
        return this.wasm_engine.calculate_all_possible_moves(depth);
    }

    attempt_move = (from_index: number, to_index: number) => {
        if (!this.initialized) return;

        return this.wasm_engine.attempt_move(from_index, to_index);
    }

    initialize = () => {
        if (this.initialized) return;

        this.wasm_engine = wasm.Engine.new();
        this.initialized = true;

        this.wasm_engine.parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        //this.wasm_engine.parse_fen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8");
    }
}

const engine = new WasmEngine();

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.Ready:
        {
            // Load the web assembly (workaround because regular importing did not seem to work right with webpack 5)
            require('bandersnatch-wasm').then((w: any) => { 
                wasm = w;

                require('bandersnatch-wasm/bandersnatch_wasm_bg.wasm').then((m: any) => { 
                    memory = m.memory;
                    engine.initialize();

                    ctx.postMessage({
                        command: e.data.command,
                    });
                });
            });

            break;
        }
        case EngineCommands.RetrieveBoard:
        {
            ctx.postMessage({
                command: e.data.command,
                board: engine.board(),
                validMoves: engine.valid_moves()
            });
            break;
        }
        case EngineCommands.AttemptMove:
        {
            const result = engine.attempt_move(e.data.fromIndex, e.data.toIndex);
            ctx.postMessage({
                command: e.data.command,
                from: e.data.fromIndex,
                to: e.data.toIndex,
                whiteTurn: engine.white_turn(),
                board: result ? { board: engine.board() } : undefined,
                validMoves: engine.valid_moves(),
                inCheck: engine.in_check(),
                captured: engine.piece_captured_this_turn(),
                castled: engine.castled_this_turn(),
                draw: engine.check_for_draw()
            });
            break;
        }
        case EngineCommands.HistoryGoBack:
        {
            // engine.stepBack();
            // const index = engine.historicalBoards.length - 1 + engine.historicalIndex;
            // ctx.postMessage({
            //     command: e.data.command,
            //     board: engine.historicalBoards[index],
            //     index: index
            // });
            break;
        }
        case EngineCommands.HistoryGoForward:
        {
            // engine.stepForward();
            // const index = engine.historicalBoards.length - 1 + engine.historicalIndex;
            // ctx.postMessage({
            //     command: e.data.command,
            //     board: engine.historicalBoards[index],
            //     index: index
            // });
            break;
        }
        case EngineCommands.UndoMove:
        {
            // if (engine.historicalIndex == 0) {
            //     engine.undoMove();
            //     const index = engine.historicalBoards.length - 1;
            //     ctx.postMessage({
            //         command: e.data.command,
            //         board: engine.historicalBoards[index],
            //         index: index
            //     });
            // }
            break;
        }
        case EngineCommands.BotBestMove:
        {
            // if (!(engine.moveCount <= 5 && engine.bookMove()))
            //     engine.evalBotMove(6);
            // ctx.postMessage({
            //     command: e.data.command,
            //     from: engine.evalBestMove.from,
            //     to: engine.evalBestMove.to,
            //     timeTaken: engine.timeTakenLastTurn,
            //     depthSearched: engine.depthSearchedThisTurn,
            //     opening: engine.currentOpening,
            //     movesFound: engine.movesFoundThisTurn,
            //     whiteTurn: engine.whiteTurn,
            //     board: engine.historicalBoards[engine.historicalBoards.length - 1],
            //     validMoves: engine.allValidMoves,
            //     inCheck: engine.inCheck,
            //     captured: engine.pieceCapturedThisTurn,
            //     castled: engine.castledThisTurn,
            //     draw: engine.checkForDraw()
            // });
            break;
        }
        case EngineCommands.BotBestMoveIterative:
        {
            // if (!(engine.moveCount <= 5 && engine.bookMove()))
            //     engine.evalBotMoveIterative();
            console.log(engine.calculate_all_possible_moves(6));
            // ctx.postMessage({
            //     command: e.data.command,
            //     from: engine.evalBestMove.from,
            //     to: engine.evalBestMove.to,
            //     timeTaken: engine.timeTakenLastTurn,
            //     depthSearched: engine.depthSearchedThisTurn,
            //     opening: engine.currentOpening,
            //     movesFound: engine.movesFoundThisTurn,
            //     whiteTurn: engine.whiteTurn,
            //     board: engine.historicalBoards[engine.historicalBoards.length - 1],
            //     validMoves: engine.allValidMoves,
            //     inCheck: engine.inCheck,
            //     captured: engine.pieceCapturedThisTurn,
            //     castled: engine.castledThisTurn,
            //     draw: engine.checkForDraw()
            // });
            break;
        }
        case EngineCommands.RetrievePieceLocations:
            ctx.postMessage({ command: e.data.command, locations: engine.piece_locations() });
            break;
        case EngineCommands.UpdateMaxMoveTime:
            //engine.searchMaxTime = e.data.time;
            break;
        default:
            break;
    }
});