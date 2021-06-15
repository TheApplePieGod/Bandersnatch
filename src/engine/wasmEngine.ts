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

    white_turn = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.white_turn;
    }

    in_check = () => {
        return false;
    }

    check_for_draw = () => {
        return false;
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
    }
}

const engine = new WasmEngine();

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.Ready:
        {
            // Load the web assembly
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
                validMoves: []
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
                validMoves: [],
                inCheck: engine.in_check(),
                captured: false,
                castled: false,
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
            // //console.log(engine.calculateAllPossibleMoves(6));
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
            //ctx.postMessage({ command: e.data.command, locations: engine.pieceLocations });
            break;
        case EngineCommands.UpdateMaxMoveTime:
            //engine.searchMaxTime = e.data.time;
            break;
        default:
            break;
    }
});