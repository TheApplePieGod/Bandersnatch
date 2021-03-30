import { EvalCommands } from "../definitions";
import { Engine } from "./engine";

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

const engine = new Engine();

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EvalCommands.UpdateState:
            engine.useHistoricalBoard(e.data.board);
            break;
        case EvalCommands.Evaluate:
            engine.findBestMoveWithIterativeDeepening();
            break;
        default:
            break;
    }
});