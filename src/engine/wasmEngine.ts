import { EvalCommands, EngineCommands, HistoricalBoard, EvalMove, DebugMoveOutput, Piece, notationToIndex, fenToPieceDict, getPieceNameShort, indexToNotation } from "../definitions";
import { openings } from "./openings";

import('bandersnatch-wasm');

console.log("wasm worker init");

// We alias self to ctx and give it our newly created type
const ctx: Worker = self as any;

(self as any).post_eval_message = (s: string, evaluation: number) => {
    ctx.postMessage({
        command: EvalCommands.ReceiveCurrentEval,
        eval: evaluation
    });
}

export class WasmEngine {
    wasm: any = null;
    memory: any = null;
    initialized = false;
    wasm_engine: any = null;
    historical_boards: HistoricalBoard[] = [];
    historical_index = 0;
    current_opening = "";
    move_list: string[] = [];
    book_move_from = 0;
    book_move_to = 0;

    constructor() {
        
    }

    board = () => {
        if (!this.initialized) return undefined;

        const board_ptr = this.wasm_engine.board_ptr();
        const board = new Uint8Array(this.memory.buffer, board_ptr, 64);
        
        return board;
    }

    set_board = (board: number[]) => {
        if (!this.initialized) return;
        this.wasm_engine.set_board(board);
    }

    valid_moves = () => {
        if (!this.initialized) return undefined;

        const moves_ptr = this.wasm_engine.valid_moves_ptr();
        const moves_len = this.wasm_engine.valid_moves_len();
        const valid_move_data = new Int32Array(this.memory.buffer, moves_ptr, moves_len * 4);

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

    moves_found_this_turn = () => {
        if (!this.initialized) return undefined;

        const moves_ptr = this.wasm_engine.moves_found_this_turn_ptr();
        const moves_len = this.wasm_engine.moves_found_this_turn_len();
        const found_moves_data = new Int32Array(this.memory.buffer, moves_ptr, moves_len * 6);

        let found_moves: DebugMoveOutput[] = [];
        for (let i = 0; i < found_moves_data.length; i += 6) {
            let move: DebugMoveOutput = {
                move: {
                    from: found_moves_data[i],
                    to: found_moves_data[i + 1],
                    data: found_moves_data[i + 2],
                    score: found_moves_data[i + 3]
                },
                piece: found_moves_data[i + 4],
                capture: found_moves_data[i + 5] == 1
            }
            
            found_moves.push(move);
        }

        return found_moves;
    }

    piece_locations = () => {
        let piece_list: number[][] = [];

        if (!this.initialized) return piece_list;

        for (let i = 0; i <= Piece.Pawn_W; i++) {
            piece_list.push(
                this.wasm_engine.piece_locations(i)
            );
        }
        return piece_list;
    }

    set_piece_locations = (locations: number[][]) => {
        if (!this.initialized) return;
        for (let i = 0; i <= Piece.Pawn_W; i++) {
            this.wasm_engine.set_piece_locations(i, locations[i]);
        }
    }

    white_turn = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.white_turn();
    }

    set_white_turn = (white_turn: boolean) => {
        if (!this.initialized) return;
        this.wasm_engine.set_white_turn(white_turn);
    }

    castle_status = () => {
        if (!this.initialized) return 0;
        return this.wasm_engine.castle_status();
    }
    
    set_castle_status = (castle_status: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_castle_status(castle_status);
    }

    en_passant_square = () => {
        if (!this.initialized) return -1;
        return this.wasm_engine.en_passant_square();
    }

    set_en_passant_square = (en_passant_square: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_en_passant_square(en_passant_square);
    }

    move_count = () => {
        if (!this.initialized) return 0;
        return this.wasm_engine.move_count();
    }

    set_move_count = (move_count: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_move_count(move_count);
    }

    move_rep_count = () => {
        if (!this.initialized) return 0;
        return this.wasm_engine.move_rep_count();
    }

    set_move_rep_count = (move_rep_count: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_move_rep_count(move_rep_count);
    }

    repetition_history = () => {
        if (!this.initialized) return undefined;

        const rep_ptr = this.wasm_engine.repetition_history_ptr();
        const rep_len = this.wasm_engine.repetition_history_len();
        const history = new BigUint64Array(this.memory.buffer, rep_ptr, rep_len);
        
        return history;
    }

    set_repetition_history = (repetition_history: bigint[]) => {
        if (!this.initialized) return;
        this.wasm_engine.set_repetition_history(repetition_history);
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

    best_move = () => {
        if (!this.initialized) return {} as EvalMove;

        const move_ptr = this.wasm_engine.best_move();
        const move_data = new Int32Array(this.memory.buffer, move_ptr, 4);

        let move: EvalMove = {
            from: move_data[0],
            to: move_data[1],
            data: move_data[2],
            score: move_data[3],
        }
        
        return move;
    }

    time_taken_last_turn = () => {
        if (!this.initialized) return 0;
        return this.wasm_engine.time_taken_last_turn();
    }

    depth_searched_last_turn = () => {
        if (!this.initialized) return 0;
        return this.wasm_engine.depth_searched_last_turn();
    }

    set_depth_searched_last_turn = (depth: number) => {
        if (!this.initialized) return;
        return this.wasm_engine.set_depth_searched_last_turn(depth);
    }

    update_max_search_time = (time: number) => {
        if (!this.initialized) return;
        this.wasm_engine.update_max_search_time(time << 0);
    }

    set_thread_count = (thread_count: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_thread_count(thread_count);
    }

    thread_index = () => {
        if (!this.initialized) return -1;
        return this.wasm_engine.thread_index();
    }
    
    set_thread_index = (thread_index: number) => {
        if (!this.initialized) return;
        this.wasm_engine.set_thread_index(thread_index);
    }

    create_historical_board = () => {
        let board = this.board();
        let rep_history = this.repetition_history();
        return {
            board: board ? [...board] : undefined,
            whiteTurn: this.white_turn(),
            castleStatus: this.castle_status(),
            enPassantSquare: this.en_passant_square(),
            pieceLocations: this.piece_locations(),
            moveCount: this.move_count(),
            moveRepCount: this.move_rep_count(),
            repetitionHistory: rep_history ? [...rep_history] : undefined,
            moveList: [...this.move_list]
        } as HistoricalBoard;
    }

    push_history = () => {
        if (!this.initialized) return;
        
        this.historical_boards.push(this.create_historical_board());
    }

    use_historical_board = (board: HistoricalBoard) => {
        if (!this.initialized) return;

        this.set_board(board.board);
        this.set_white_turn(board.whiteTurn);
        this.set_castle_status(board.castleStatus);
        this.set_en_passant_square(board.enPassantSquare);
        this.set_piece_locations(board.pieceLocations);
        this.set_move_count(board.moveCount);
        this.set_move_rep_count(board.moveCount);
        this.set_repetition_history(board.repetitionHistory);
        this.move_list = [...board.moveList];
        this.wasm_engine.use_historical_board();
    }

    step_back = () => {
        if (!this.initialized) return;

        if (Math.abs(this.historical_index) < this.historical_boards.length - 1) {
            this.historical_index--;

            const board = this.historical_boards[this.historical_boards.length - 1 + this.historical_index];
            this.use_historical_board(board);
        }
    }

    step_forward = () => {
        if (!this.initialized) return;

        if (this.historical_index < 0) {
            this.historical_index++;
            const board = this.historical_boards[this.historical_boards.length - 1 + this.historical_index];
            this.use_historical_board(board);
        }
    }

    undo_move = () => {
        if (!this.initialized) return;

        if (this.historical_boards.length > 1 && this.historical_index == 0) {
            this.historical_index = 0;
            const board = this.historical_boards[this.historical_boards.length - 2];
            this.use_historical_board(board);
            this.historical_boards.pop();
        }
    }

    check_for_draw = () => {
        if (!this.initialized) return false;
        return this.wasm_engine.check_for_draw();
    }

    calculate_all_possible_moves = (depth: number) => {
        if (!this.initialized) return 0;
        return this.wasm_engine.calculate_all_possible_moves(depth);
    }

    eval_bot_move = (depth: number, threaded: boolean) => {
        if (!this.initialized) return;
        return this.wasm_engine.eval_bot_move(depth, threaded);
    }

    eval_bot_move_iterative = () => {
        if (!this.initialized) return;
        return this.wasm_engine.eval_bot_move_iterative();
    }

    find_best_move_iterative = () => {
        if (!this.initialized) return;
        return this.wasm_engine.find_best_move_iterative();
    }

    attempt_move = (from_index: number, to_index: number) => {
        if (!this.initialized) return;
        return this.wasm_engine.attempt_move(from_index, to_index);
    }

    find_piece_in_file = (piece: number, file: string) => {
        if (!this.initialized) return -1;
        return this.wasm_engine.find_piece_in_file(piece, file);
    }

    // keep some of these functions in js because they aren't bottlenecked and would be a pain to convert over
    generate_move_string = (fromIndex: number, toIndex: number) => {
        if (this.castled_this_turn()) {
            if (this.white_turn()) { // todo: O-O-O

            }
            return "O-O";
        }

        const board = this.board();
        if (!board)
            return "";

        let pieceName = getPieceNameShort(board[toIndex]).toUpperCase(); // for opening comparison
        if (pieceName == "" && this.piece_captured_this_turn()) { // pawn capture so get the name of the file it came from
            pieceName = indexToNotation(fromIndex)[0];
        }
        const newLocation = indexToNotation(toIndex);

        return `${pieceName}${this.piece_captured_this_turn() ? 'x' : ''}${newLocation}${this.in_check() ? '+' : ''}`;
    }

    book_move = () => { // a bit messy, cleanup ?
        try {
            const valid_moves = this.valid_moves();
            const board = this.board();

            if (!valid_moves || !board)
                return false;

            if (this.move_count() == 0) { // if its move one, play a random opening
                const index = Math.floor(Math.random() * openings.length);
                const opening = openings[index];
                const move = opening.moves[0];
                move.replace(/\W/g, '');
                const file = move[move.length - 2];
                const rank = parseInt(move[move.length - 1]);
                let from = -1;
                let to = notationToIndex(rank, file);

                if (move.length == 2) { // pawn move
                    from = this.find_piece_in_file(Piece.Pawn_W, file); // always white since move zero
                } else { // otherwise find the piece with that move as valid
                    const pieceName = move[0];
                    const piece = fenToPieceDict[this.white_turn() ? pieceName.toUpperCase() : pieceName.toLowerCase()];

                    for (let i = 0; i < valid_moves.length; i++) {
                        if (board[valid_moves[i].from] == piece && valid_moves[i].to == to) {
                            from = valid_moves[i].from;
                            break;
                        }
                    }
                }

                if (from == -1 || to == -1)
                    return false;

                this.current_opening = opening.name;
                let result = this.attempt_move(from, to);
                if (result) {
                    this.move_list.push(move);
                    this.book_move_from = from;
                    this.book_move_to = to;
                    return true;
                }
                return false;
            } else { // otherwise we must interpret the position and decide if this opening exists
                let validOpenings: number[] = [];
                for (let i = 0; i < openings.length; i++) {
                    if (openings[i].moves.length > this.move_list.length)
                        if (this.move_list.every((e, j) => e == openings[i].moves[j]))
                            validOpenings.push(i);
                }

                if (validOpenings.length == 0) {
                    return false;
                }

                // then pick a random opening from the valid ones and make the next move
                const index = Math.floor(Math.random() * validOpenings.length);
                const opening = openings[validOpenings[index]];
                const move = opening.moves[this.move_list.length];
                move.replace(/\W/g, '');
                const file = move[move.length - 2];
                const rank = parseInt(move[move.length - 1]);
                let from = -1;
                let to = notationToIndex(rank, file);

                if (move.length == 2) { // pawn move
                    from = this.find_piece_in_file(this.white_turn() ? Piece.Pawn_W : Piece.Pawn_B, file);
                } else { // otherwise find the piece with that move as valid
                    const pieceName = move[0];
                    let piece = fenToPieceDict[this.white_turn() ? pieceName.toUpperCase() : pieceName.toLowerCase()];
                    for (let i = 0; i < valid_moves.length; i++) {
                        if (board[valid_moves[i].from] == piece && valid_moves[i].to == to) {
                            from = valid_moves[i].from;
                            break;
                        }
                    }

                    // if not found, its likely a pawn capture move
                    piece = this.white_turn() ? Piece.Pawn_W : Piece.Pawn_B;
                    if (from == -1 ){
                        for (let i = 0; i < valid_moves.length; i++) {
                            if (board[valid_moves[i].from] == piece && valid_moves[i].to == to) {
                                from = valid_moves[i].from;
                                break;
                            }
                        }
                    }
                }

                if (from == -1 || to == -1)
                    return false;

                this.current_opening = opening.name;
                let result = this.attempt_move(from, to);
                if (result) {
                    this.move_list.push(move);
                    this.book_move_from = from;
                    this.book_move_to = to;
                    return true;
                }
                return false;
            }
        } catch (e) { // if something goes wrong, just cancel
            //this.useHistoricalBoard(this.historicalBoards[this.historicalBoards.length - 1]);
            return false;
        }
    }

    initialize = () => {
        if (this.initialized) return;

        this.wasm_engine = this.wasm.Engine.new();
        this.initialized = true;

        this.wasm_engine.parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        //this.wasm_engine.parse_fen("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8");
        //this.wasm_engine.parse_fen("rnbqkbnr/pppp1ppp/8/4p3/8/2NP4/PPP1PPPP/R1BQKBNR b KQkq - 0 8");

        this.push_history();
    }

    reset_game = () => {
        if (!this.initialized) return;
        this.wasm_engine.parse_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        this.historical_boards = [];
        this.historical_index = 0;
        this.current_opening = "";
        this.move_list = [];
        this.push_history();
    }
}

const engine = new WasmEngine();
let loading = true;

ctx.addEventListener("message", (e) => {
    switch (e.data.command) {
        case EngineCommands.Ready:
        {
            // Load the web assembly (workaround because regular importing did not seem to work right with webpack 5)
            //import('bandersnatch-wasm');

            setInterval(() => {
                if (!loading)
                    return;

                require('bandersnatch-wasm').then((w: any) => { 
                    engine.wasm = w;

                    if (w == undefined || !('Engine' in w))
                        return;

                    loading = false;
                    require('bandersnatch-wasm/bandersnatch_wasm_bg.wasm').then((m: any) => { 
                        engine.memory = m.memory;
                        engine.initialize();
                        //engine.set_thread_count(e.data.threadCount);
                        //engine.set_thread_index(e.data.threadIndex);
    
                        ctx.postMessage({
                            command: e.data.command,
                        });
                    });
                });
            }, 200);            

            break;
        }
        case EngineCommands.UpdateThreadingInfo:
        {
            engine.set_thread_count(e.data.threadCount);
            engine.set_thread_index(e.data.threadIndex);

            break;
        }
        case EngineCommands.RetrieveBoard:
        {
            ctx.postMessage({
                command: e.data.command,
                board: engine.historical_boards[engine.historical_boards.length - 1],
                validMoves: engine.valid_moves()
            });
            break;
        }
        case EngineCommands.AttemptMove:
        {
            let result = false;
            if (engine.historical_index == 0)
            {
                result = engine.attempt_move(e.data.fromIndex, e.data.toIndex);
                if (result) {
                    engine.push_history();
                    engine.move_list.push(engine.generate_move_string(e.data.fromIndex, e.data.toIndex));
                }
            }

            ctx.postMessage({
                command: e.data.command,
                from: e.data.fromIndex,
                to: e.data.toIndex,
                whiteTurn: engine.white_turn(),
                board: result ? engine.historical_boards[engine.historical_boards.length - 1] : undefined,
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
            engine.step_back();
            const index = engine.historical_boards.length - 1 + engine.historical_index;
            ctx.postMessage({
                command: e.data.command,
                board: engine.historical_boards[index],
                index: index
            });
            break;
        }
        case EngineCommands.HistoryGoForward:
        {
            engine.step_forward();
            const index = engine.historical_boards.length - 1 + engine.historical_index;
            ctx.postMessage({
                command: e.data.command,
                board: engine.historical_boards[index],
                index: index
            });
            break;
        }
        case EngineCommands.UndoMove:
        {
            if (engine.historical_index == 0) {
                engine.undo_move();
                const index = engine.historical_boards.length - 1;
                ctx.postMessage({
                    command: e.data.command,
                    board: engine.historical_boards[index],
                    index: index
                });
            }
            break;
        }
        case EngineCommands.BotBestMove:
        {
            if (engine.historical_index != 0)
                return;

            let from = 0;
            let to = 0;
            if (!(e.data.bookMoves && engine.move_count() <= 5 && engine.book_move())) {
                if (engine.eval_bot_move(6, false)) {
                    engine.push_history();
                    from = engine.best_move().from;
                    to = engine.best_move().to;
                    engine.move_list.push(engine.generate_move_string(from, to));
                }
            } else {
                engine.set_depth_searched_last_turn(-1);
                engine.push_history();
                from = engine.book_move_from;
                to = engine.book_move_to;
            }

            ctx.postMessage({
                command: e.data.command,
                from: from,
                to: to,
                timeTaken: engine.time_taken_last_turn(),
                depthSearched: engine.depth_searched_last_turn(),
                opening: engine.current_opening,
                movesFound: engine.moves_found_this_turn(),
                whiteTurn: engine.white_turn(),
                board: engine.historical_boards[engine.historical_boards.length - 1],
                validMoves: engine.valid_moves(),
                inCheck: engine.in_check(),
                captured: engine.piece_captured_this_turn(),
                castled: engine.castled_this_turn(),
                draw: engine.check_for_draw()
            });
            break;
        }
        case EngineCommands.BotBestMoveThreaded:
        {
            if (engine.historical_index != 0)
                return;

            engine.eval_bot_move(6, true);

            ctx.postMessage({
                command: e.data.command,
                bestMove: engine.best_move(),
                timeTaken: engine.time_taken_last_turn(),
                movesFound: engine.moves_found_this_turn()
            });
            break;
        }
        case EngineCommands.BotBestMoveIterative:
        {
            if (engine.historical_index != 0)
                return;
            
            let from = 0;
            let to = 0;
            if (!(e.data.bookMoves && engine.move_count() <= 5 && engine.book_move())) {
                if (engine.eval_bot_move_iterative()) {
                    engine.push_history();
                    from = engine.best_move().from;
                    to = engine.best_move().to;
                    engine.move_list.push(engine.generate_move_string(from, to));
                }
            } else {
                engine.set_depth_searched_last_turn(-1);
                engine.push_history();
                from = engine.book_move_from;
                to = engine.book_move_to;
            }

            //console.log(engine.calculate_all_possible_moves(3));

            ctx.postMessage({
                command: e.data.command,
                from: from,
                to: to,
                timeTaken: engine.time_taken_last_turn(),
                depthSearched: engine.depth_searched_last_turn(),
                opening: engine.current_opening,
                movesFound: engine.moves_found_this_turn(),
                whiteTurn: engine.white_turn(),
                board: engine.historical_boards[engine.historical_boards.length - 1],
                validMoves: engine.valid_moves(),
                inCheck: engine.in_check(),
                captured: engine.piece_captured_this_turn(),
                castled: engine.castled_this_turn(),
                draw: engine.check_for_draw()
            });
            break;
        }
        case EngineCommands.SetHistory:
        {
            engine.historical_boards = e.data.boards;
            engine.historical_index = e.data.index;
            engine.use_historical_board(e.data.boards[e.data.boards.length - 1 + e.data.index]);
            break;
        }
        case EngineCommands.ResetGame:
        {
            engine.reset_game();
            break;
        }
        case EngineCommands.RetrievePieceLocations:
            ctx.postMessage({ command: e.data.command, locations: engine.piece_locations() });
            break;
        case EngineCommands.UpdateMaxMoveTime:
            engine.update_max_search_time(e.data.time);
            break;
        default:
            break;
    }
});