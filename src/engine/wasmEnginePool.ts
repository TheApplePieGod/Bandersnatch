import WasmEngineWorker from "worker-loader!./wasmEngine";
import { EngineCommands, EvalMove } from "../definitions";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

// must be >= 1
const pool_size = 8;
let pool: WasmEngineWorker[] = [];

let processing_command = false;
let current_command = EngineCommands.Ready;
let workers_complete = 0;
let best_moves: EvalMove[] = [];
let max_search_time: number = 0;

const handle_pool_message = (e: MessageEvent) => {
    switch (e.data.command) {
        case EngineCommands.Ready: {
            workers_complete++;

            if (workers_complete == pool_size) {
                processing_command = false;
                ctx.postMessage({
                    command: e.data.command
                });
            }

            break;
        }
        case EngineCommands.RetrieveBoard: {
            ctx.postMessage({
                command: e.data.command,
                board: e.data.board,
                validMoves: e.data.validMoves
            });
            break;
        }
        case EngineCommands.AttemptMove: {
            workers_complete++;

            if (workers_complete == pool_size) {
                processing_command = false;

                ctx.postMessage({
                    command: current_command,
                    from: e.data.from,
                    to: e.data.to,
                    timeTaken: max_search_time,
                    depthSearched: 0,
                    opening: "",
                    movesFound: [],
                    whiteTurn: e.data.whiteTurn,
                    board: e.data.board,
                    validMoves: e.data.validMoves,
                    inCheck: e.data.inCheck,
                    captured: e.data.captured,
                    castled: e.data.castled,
                    draw: e.data.draw
                })
            }

            break;
        }
        case EngineCommands.BotBestMoveThreaded: {
            workers_complete++;
            best_moves.push(e.data.bestMove);
            if (e.data.timeTaken > max_search_time) {
                max_search_time = e.data.timeTaken;
            }
            //console.log(e.data.bestMove)

            if (workers_complete == pool_size) {
                let best_move: EvalMove = {
                    from: 0,
                    to: 0,
                    score: Number.MIN_SAFE_INTEGER,
                    data: 0,
                };
                for (let i = best_moves.length - 1; i >= 0; i--) {
                    if (best_moves[i].score >= best_move.score) {
                        best_move = best_moves[i];
                    }
                }

                //console.log(best_move)

                workers_complete = 0;

                // make the move on all of the worker boards and wait for the response in AttemptMove
                for (let i = 0; i < pool_size; i++) {
                    pool[i].postMessage({
                        command: EngineCommands.AttemptMove,
                        fromIndex: best_move.from,
                        toIndex: best_move.to
                    });
                }
            }

            break;
        }
        default:
            break;
    }
}

const init_pool = () => {
    for (let i = 0; i < pool_size; i++) {
        pool.push(new WasmEngineWorker());

        pool[i].onmessage = handle_pool_message;
        pool[i].postMessage({
            command: EngineCommands.Ready,
            threadCount: pool_size,
            threadIndex: i
        })
    }
}

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.Ready: {
            if (!processing_command) {
                current_command = EngineCommands.Ready;
                processing_command = true;
                workers_complete = 0;
                init_pool();
            }
            break;
        }
        case EngineCommands.RetrieveBoard: {
            pool[0].postMessage({
                command: e.data.command
            })

            break;
        }
        case EngineCommands.BotBestMove:
        case EngineCommands.BotBestMoveThreaded: {
            if (!processing_command) {
                current_command = EngineCommands.BotBestMove;
                processing_command = true;
                workers_complete = 0;
                max_search_time = 0;
                best_moves = [];
                for (let i = 0; i < pool_size; i++) {
                    pool[i].postMessage({
                        command: EngineCommands.BotBestMoveThreaded
                    });
                }
            }

            break;
        }
        default:
            break;
    }
});



