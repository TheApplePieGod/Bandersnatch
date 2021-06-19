import { EvalCommands } from "../definitions";
import { WasmEngine } from "./wasmEngine";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

(self as any).post_eval_message = (s: string, evaluation: number) => {
    ctx.postMessage({
        command: EvalCommands.ReceiveCurrentEval,
        eval: evaluation
    });
}

const engine = new WasmEngine();
require('bandersnatch-wasm').then((w: any) => { 
    engine.wasm = w;

    require('bandersnatch-wasm/bandersnatch_wasm_bg.wasm').then((m: any) => { 
        engine.memory = m.memory;
        engine.initialize();
        engine.update_max_search_time(5000);
    });
});

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EvalCommands.UpdateState:
            engine.use_historical_board(e.data.board);
            break;
        case EvalCommands.Evaluate:
            engine.find_best_move_iterative();
            break;
        default:
            break;
    }
});