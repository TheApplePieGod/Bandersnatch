import { Button, FormControlLabel, Checkbox, Typography, Paper, Slider } from '@material-ui/core';
import bigInt from 'big-integer';
import React from 'react';
import { Piece, getPieceName, getPieceNameShort, EngineCommands, Sounds, EvalMove, EvalCommands, HistoricalBoard, DebugMoveOutput, notationToIndex, indexToNotation } from "../../definitions";
import EngineWorker from "worker-loader!../../engine/engine";
import WasmEngine from "worker-loader!../../engine/wasmEngine";
import EvalWorker from "worker-loader!../../engine/evaluation";
import { EvaluationBar } from './evaluationBar';
import { InfoButton } from './infoButton';

interface Props {

}

interface State {
    width: number;
    height: number;
    cellSize: number;
    showNumbers: boolean;
    showValidMoves: boolean;
    waitingForMove: boolean;
    botMoveAutoplay: boolean;
    playAgainstBot: boolean;
    botIterative: boolean;
    currentEval: number;
    localHistory: History[];
    historyIndex: number;
    botMaxMoveTime: number;
}

interface History {
    lastMoveFrom: number;
    lastMoveTo: number;
    soundMade: number;
    movesConsidered: DebugMoveOutput[];
    validMoves: EvalMove[];
    moveTime: number;
    searchDepth: number;
    opening: string;
    whiteTurn: boolean;
}

export class Board extends React.Component<Props, State> {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    images: Record<number, HTMLImageElement>;
    engineWorker = new EngineWorker();
    wasmWorker = new WasmEngine();
    evalWorker = new EvalWorker();

    evalTimeout: any = 0;
    nextBoardToEval: HistoricalBoard | undefined = undefined;

    localBoard: number[];
    animationFrameId = 0;
    draggingIndex = -1;
    relativeMousePos = { x: 0, y: 0 };
    boardSize = 8;
    botMoveMinTime = 500;
    rendering = false;

    constructor(props: Props) {
        super(props);
        this.canvasRef = React.createRef<HTMLCanvasElement>();
        this.localBoard = new Array(64);
        this.images = {};
        this.state = {
            width: window.innerWidth,
            height: window.innerHeight,
            cellSize: Math.floor(Math.min(window.innerWidth * this.boardScaleFactor(window.innerWidth), window.innerHeight * this.boardScaleFactor(window.innerWidth)) / 8),
            showNumbers: true,
            showValidMoves: true,
            waitingForMove: false,
            botMoveAutoplay: false,
            playAgainstBot: false,
            botIterative: false,
            currentEval: 0,
            localHistory: [],
            historyIndex: 0,
            botMaxMoveTime: 3
        };

        this.engine().onmessage = this.handleMessage;
        this.evalWorker.onmessage = this.handleEvalMessage;
    }

    engine = () => {
        const isWasm = true;
        if (isWasm)
            return this.wasmWorker;
        else
            return this.engineWorker;
    }

    boardScaleFactor = (width: number) => {
        if (width < 900)
            return 0.95;
        else
            return 0.7;
    }

    playSound = (sound: number) => {
        switch (sound) {
            case Sounds.PieceMoved:
            {
                const audio = new Audio("sounds/move.wav");
                audio.play();
                break;
            }
            case Sounds.PieceMoved2:
            {
                const audio = new Audio("sounds/move2.wav");
                audio.play();
                break;
            }
            case Sounds.PieceCaptured:
            {
                const audio = new Audio("sounds/capture.wav");
                audio.play();
                break;
            }
            case Sounds.Checked:
            {
                const audio = new Audio("sounds/check.wav");
                audio.play();
                break;
            }
            case Sounds.GameOver:
            {
                const audio = new Audio("sounds/game-end.wav");
                audio.play();
                break;
            }
            case Sounds.Castled:
             {
                const audio = new Audio("sounds/castle.wav");
                audio.play();
                break;
            }
            case Sounds.IllegalMove:
             {
                const audio = new Audio("sounds/illegal.wav");
                audio.play();
                break;
            }
            default:
                break;
        }
    }

    handleEvalMessage = (e: MessageEvent) => {
        switch (e.data.command) {
            case EvalCommands.ReceiveCurrentEval:
                this.setState({ currentEval: e.data.eval });
                break;
            default:
                break;
        }
    }

    handleMessage = (e: MessageEvent) => {
        switch (e.data.command) {
            case EngineCommands.Ready:
                this.engine().postMessage({ command: EngineCommands.RetrieveBoard });
                break;
            case EngineCommands.RetrieveBoard:
                this.localBoard = e.data.board;
                this.setState({
                    localHistory: [{
                        lastMoveFrom: -1,
                        lastMoveTo: -1,
                        soundMade: 0,
                        validMoves: e.data.validMoves,
                        movesConsidered: [],
                        opening: "",
                        moveTime: 0,
                        searchDepth: 0,
                        whiteTurn: true
                    }]
                }, () => {
                    if (!this.rendering)
                        this.startRendering();
                });
                break;
            case EngineCommands.AttemptMove:
            {
                if (e.data.board != undefined) {
                    this.localBoard = e.data.board.board;
                    let validMoves: EvalMove[] = [];

                    if (!e.data.draw)
                        validMoves = e.data.validMoves;

                    const checkmate = validMoves.length == 0;

                    if (!checkmate && !e.data.draw && this.state.playAgainstBot)
                        this.botMove();

                    let soundToPlay = 0;
                    if (checkmate || e.data.draw) {
                        soundToPlay = Sounds.GameOver;
                    } else {
                        if (e.data.inCheck)
                            soundToPlay = Sounds.Checked;
                        else {
                            if (e.data.captured)
                                soundToPlay = Sounds.PieceCaptured;
                            else if (e.data.castled)
                                soundToPlay = Sounds.Castled;
                            else
                                soundToPlay = Sounds.PieceMoved;
                        }
                        this.nextBoardToEval = e.data.board;
                    }
                    this.playSound(soundToPlay);

                    this.setState({
                        historyIndex: this.state.historyIndex + 1,
                        localHistory: this.state.localHistory.concat([{
                            lastMoveFrom: e.data.from,
                            lastMoveTo: e.data.to,
                            soundMade: soundToPlay,
                            validMoves: validMoves,
                            movesConsidered: [],
                            moveTime: 0,
                            opening: "",
                            searchDepth: 0,
                            whiteTurn: e.data.whiteTurn
                        }])
                    });
                } else {
                    this.playSound(Sounds.IllegalMove);
                }
                this.draggingIndex = -1;
                
                break;
            }
            case EngineCommands.HistoryGoBack:
            case EngineCommands.HistoryGoForward:
            case EngineCommands.UndoMove:
                const entry = this.state.localHistory[e.data.index];
                
                if (e.data.index != this.state.historyIndex) {
                    this.playSound(entry.soundMade); 
                }

                this.localBoard = e.data.board.board;
                    
                this.setState({ historyIndex: e.data.index });

                if (e.data.command == EngineCommands.UndoMove) {
                    this.setState({ localHistory: this.state.localHistory.slice(0, -1) });
                    this.nextBoardToEval = e.data.board;
                }

                break;
            case EngineCommands.BotBestMove:
            case EngineCommands.BotBestMoveIterative:
                const updateData = () => {
                    this.localBoard = e.data.board.board;
                    let validMoves: EvalMove[] = [];
    
                    if (!e.data.draw)
                        validMoves = e.data.validMoves;

                    const checkmate = validMoves.length == 0;
    
                    if (!checkmate && !e.data.draw && this.state.botMoveAutoplay) {
                        this.engine().postMessage({ command: e.data.command });
                    } else {
                        this.setState({ waitingForMove: false });
                    }
                    
                    let soundToPlay = 0;
                    if (checkmate || e.data.draw) {
                        soundToPlay = Sounds.GameOver;
                    } else {
                        if (e.data.inCheck)
                            soundToPlay = Sounds.Checked;
                        else {
                            if (e.data.captured)
                                soundToPlay = Sounds.PieceCaptured;
                            else if (e.data.castled)
                                soundToPlay = Sounds.Castled;
                            else
                                soundToPlay = Sounds.PieceMoved;
                        }
                        this.nextBoardToEval = e.data.board;
                    }
                    this.playSound(soundToPlay);

                    this.setState({
                        historyIndex: this.state.historyIndex + 1,
                        localHistory: this.state.localHistory.concat([{
                            lastMoveFrom: e.data.from,
                            lastMoveTo: e.data.to,
                            soundMade: soundToPlay,
                            validMoves: validMoves,
                            movesConsidered: e.data.movesFound,
                            moveTime: e.data.timeTaken,
                            searchDepth: e.data.depthSearched,
                            opening: e.data.opening,
                            whiteTurn: e.data.whiteTurn
                        }])
                    });
                }

                if (e.data.timeTaken < this.botMoveMinTime) { // artifically add a delay if the move was made too quickly
                    setTimeout(updateData, this.botMoveMinTime - e.data.timeTaken);
                } else {
                    updateData();
                }

                break;
            case EngineCommands.RetrievePieceLocations:
                let finalString = "Black:\n";

                for (let i = 1; i < e.data.locations.length; i++) {
                    if (i == 7)
                        finalString += "\White:\n";
                    let line = `${getPieceName(i)}: `;
                    for (let j = 0; j < e.data.locations[i].length; j++) {
                        line += e.data.locations[i][j].toString() + ',';
                    }
                    finalString += line + '\n';
                }
                console.log(finalString);
            default:
                break;
        }
    }

    init = () => {
        const imagePaths: Record<number, string> = {
            [Piece.King_B]: "images/King_B.svg",
            [Piece.Queen_B]: "images/Queen_B.svg",
            [Piece.Rook_B]: "images/Rook_B.svg",
            [Piece.Bishop_B]: "images/Bishop_B.svg",
            [Piece.Knight_B]: "images/Knight_B.svg",
            [Piece.Pawn_B]: "images/Pawn_B.svg",
            [Piece.King_W]: "images/King_W.svg",
            [Piece.Queen_W]: "images/Queen_W.svg",
            [Piece.Rook_W]: "images/Rook_W.svg",
            [Piece.Bishop_W]: "images/Bishop_W.svg",
            [Piece.Knight_W]: "images/Knight_W.svg",
            [Piece.Pawn_W]: "images/Pawn_W.svg",
        };

        for (let key in imagePaths) {
            let img = new Image();
            img.src = imagePaths[key];
            this.images[key] = img;
        }

        setTimeout(() => this.engine().postMessage({ command: EngineCommands.Ready }), 200);
    }

    startRendering = () => {
        if (!this.canvasRef.current)
            return; 

        const ctx = this.canvasRef.current.getContext('2d');
        if (!ctx)
            return;

        let frameCount = 0;
        const render = () => {
            // frame setup
            frameCount++;
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // draw commands
            this.draw(ctx, frameCount);

            // frame cleanup
            this.animationFrameId =  window.requestAnimationFrame(render);
        }
        render();
    }

    requestEvaluation = () => {
        if (this.nextBoardToEval != undefined) {
            //this.evalWorker.postMessage({ command: EvalCommands.UpdateState, board: this.nextBoardToEval });
            //this.evalWorker.postMessage({ command: EvalCommands.Evaluate });
            this.nextBoardToEval = undefined;
        }
    }

    componentDidMount = () => {
        this.init();
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("resize", this.handleResize);
        this.evalTimeout = setInterval(this.requestEvaluation, 3000);
    }

    componentWillUnmount = () => {
        window.cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("resize", this.handleResize);
        clearInterval(this.evalTimeout);
    }

    drawBoard = (ctx: CanvasRenderingContext2D) => {
        const { boardSize, localBoard, images, relativeMousePos } = this;
        const { cellSize } = this.state;
        const { lastMoveTo, lastMoveFrom, validMoves } = this.state.localHistory[this.state.historyIndex];

        let xPos = 0;
        let yPos = 0;
        for (let y = 0; y < boardSize; y++) {
            for (let x = 0; x < boardSize; x++) {
                const boardIndex = (y * boardSize) + x;
                const piece = localBoard[boardIndex];

                ctx.fillStyle = (x + y) % 2 == 1 ? '#403e38' : '#ded6c1';
                ctx.fillRect(xPos, yPos, cellSize, cellSize);

                if (boardIndex == this.draggingIndex) {
                    ctx.fillStyle = '#2c4ed470';
                    ctx.fillRect(xPos, yPos, cellSize, cellSize);
                }
                else if (boardIndex == lastMoveFrom || boardIndex == lastMoveTo) {
                    ctx.fillStyle = '#f57b4270';
                    ctx.fillRect(xPos, yPos, cellSize, cellSize);
                }

                if (this.state.showValidMoves) {
                    if (validMoves.some(e => e.from == this.draggingIndex && e.to == boardIndex)) {
                        ctx.fillStyle = '#d8f51d70';
                        ctx.fillRect(xPos, yPos, cellSize, cellSize);
                    }
                }
                
                if (piece != Piece.Empty) {
                    if (piece in images && images[piece].complete)
                        if (boardIndex != this.draggingIndex)
                            ctx.drawImage(images[piece], xPos, yPos, cellSize, cellSize);
                }

                const fontSize = cellSize * 0.25;
                ctx.fillStyle = '#ff000d';
                ctx.font = `${fontSize}px arial`;
                if (this.state.showNumbers) {
                    ctx.fillText(boardIndex.toString(), xPos, yPos + cellSize);
                }
                if (x == 0) {
                    ctx.fillText(`${8 - y}`, xPos, yPos + fontSize);
                }
                if (y == 7) {
                    ctx.fillText(`${String.fromCharCode(x + 97)}`, xPos + cellSize - (fontSize * 0.6), yPos + cellSize - (fontSize * 0.2));
                }

                xPos += cellSize;
            }
            yPos += cellSize;
            xPos = 0;
        }

        // debug texts
        xPos = 0;
        ctx.fillStyle = '#ff000d';
        ctx.font = `${this.state.cellSize * 0.5}px arial`;

        if (this.draggingIndex >= 0 && this.draggingIndex < localBoard.length) {
            const piece = localBoard[this.draggingIndex];
            if (piece != Piece.Empty)
                ctx.drawImage(images[piece], relativeMousePos.x - (cellSize * 0.5), relativeMousePos.y - (cellSize * 0.5), cellSize, cellSize);
        }
    }

    draw = (ctx: CanvasRenderingContext2D, frameCount: number) => {
        this.drawBoard(ctx);
    }

    getMouseBoardIndex = () => {
        const { relativeMousePos } = this;
        const x = Math.floor(relativeMousePos.x / this.state.cellSize);
        const y = Math.floor(relativeMousePos.y / this.state.cellSize);
        const finalIndex = x + (y * this.boardSize);
        return finalIndex;
    }

    onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!this.canvasRef.current)
            return;

        const cRect = this.canvasRef.current.getBoundingClientRect();
        this.relativeMousePos.x = Math.round(e.clientX - cRect.left);
        this.relativeMousePos.y = Math.round(e.clientY - cRect.top);
    }

    onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (!this.canvasRef.current)
            return;

        const cRect = this.canvasRef.current.getBoundingClientRect();
        this.relativeMousePos.x = Math.round(e.touches[0].pageX - this.canvasRef.current.offsetLeft);
        this.relativeMousePos.y = Math.round(e.touches[0].pageY - this.canvasRef.current.offsetTop);
    }

    handleResize = () => {
        const { innerWidth: width, innerHeight: height } = window;
        this.setState({
            width: width,
            height: height,
            cellSize: Math.floor(Math.min(width * this.boardScaleFactor(this.state.width), height * this.boardScaleFactor(this.state.width)) / 8)
        });
    }

    onMouseDown = () => {
        const index = this.getMouseBoardIndex();
        if (this.localBoard[index] != Piece.Empty)
            this.draggingIndex = index; 
    }

    onTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        this.onTouchMove(e);
        this.onMouseDown();
    }

    onMouseUp = () => {
        if (this.draggingIndex != -1) {
            if (!this.state.waitingForMove) {
                const boardIndex = this.getMouseBoardIndex();
                if (boardIndex != this.draggingIndex)
                    this.engine().postMessage({ command: EngineCommands.AttemptMove, fromIndex: this.draggingIndex, toIndex: boardIndex });
                else
                    this.draggingIndex = -1;
            } else {
                this.draggingIndex = -1;
                this.playSound(Sounds.IllegalMove);
            }
        } 
    }

    historyGoForward = () => {
        if (!this.state.waitingForMove) {
            this.engine().postMessage({ command: EngineCommands.HistoryGoForward });
        }
    }

    historyGoBack = () => {
        if (!this.state.waitingForMove) {
            this.engine().postMessage({ command: EngineCommands.HistoryGoBack });
        }
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.key == "ArrowLeft")
            this.historyGoBack();
        else if (e.key == "ArrowRight")
            this.historyGoForward();
    }

    undoLastMove = () => {
        this.engine().postMessage({ command: EngineCommands.UndoMove });
    }

    getAllMoves = () => {
        //console.log(this.engine.calculateAllPossibleMoves(6));
    }

    printPieceLocations = () => {
        this.engine().postMessage({ command: EngineCommands.RetrievePieceLocations });
    }

    botMove = () => {
        if (!this.state.waitingForMove) {
            this.setState({ waitingForMove: true });
            this.engine().postMessage({ command: this.state.botIterative ? EngineCommands.BotBestMoveIterative : EngineCommands.BotBestMove });
        }
    }

    debugMoveToText = (move: DebugMoveOutput) => {
        const score = !this.state.localHistory[this.state.historyIndex].whiteTurn ? move.move.score : -1 * move.move.score;
        const from = getPieceNameShort(move.piece) + indexToNotation(move.move.from);
        const to = indexToNotation(move.move.to);
        return `${from} ${move.capture ? 'x' : "=>"} ${to} (${score > 0 ? '+' : ''}${Math.floor(score)})`;
    }

    updateBotMaxMoveTime = (e: React.ChangeEvent<{}>, value: number | number[]) => {
        if (!this.state.waitingForMove) {
            this.setState({ botMaxMoveTime: value as number });
            this.engine().postMessage({ command: EngineCommands.UpdateMaxMoveTime, time: (value as number) * 1000 });
        }
    }

    render = () => {
        if (this.state.historyIndex == -1 || this.state.localHistory.length == 0)
            return <Typography color="textPrimary">Loading...</Typography>

        const { localHistory, historyIndex } = this.state;
        const { whiteTurn, moveTime, searchDepth, movesConsidered, opening } = localHistory[historyIndex];
        return (
        <div style={{ display: "flex", flexDirection: this.state.width < 900 ? "column-reverse" : "row" }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: "20px", marginBottom: "50px", minWidth: "300px", maxWidth: "300px" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <Typography variant="h4" color="textSecondary">Bandersnatch</Typography>
                    <InfoButton title="Welcome">
                        Start dragging pieces to get started. Explore all the options and feel free to view the brief description of each. The bar underneath the board is the bot's evaluation of the current position (positive being white advantage and negative being black advantage). The evaluation takes about 3-5 seconds to update each time a move is made
                    </InfoButton>
                </div>
                <div>
                    <FormControlLabel
                        control={<Checkbox checked={this.state.showNumbers} onChange={() => this.setState({ showNumbers: !this.state.showNumbers })} name="asd" />}
                        label={<Typography color="textPrimary">Show Grid Numbers</Typography>}
                    />
                    <InfoButton title="Show Grid Numbers">
                        Show the programmatic indexes 0-63 of each square on the board
                    </InfoButton>
                </div>
                <div>
                    <FormControlLabel
                        control={<Checkbox checked={this.state.showValidMoves} onChange={() => this.setState({ showValidMoves: !this.state.showValidMoves })} />}
                        label={<Typography color="textPrimary">Show Legal Moves</Typography>}
                    />
                    <InfoButton title="Show Legal Moves">
                        Highlight the legal moves of each piece in yellow when the piece is picked up
                    </InfoButton>
                </div>
                <div>
                    <FormControlLabel
                        control={<Checkbox checked={this.state.botMoveAutoplay} onChange={() => this.setState({ botMoveAutoplay: !this.state.botMoveAutoplay })} />}
                        label={<Typography color="textPrimary">Bot Autoplay</Typography>}
                    />
                    <InfoButton title="Bot Autoplay">
                        When enabled, after the 'Bot Move' button is clicked, the bot will continue to play against itself
                    </InfoButton>
                </div>
                <div>
                    <FormControlLabel
                        control={<Checkbox checked={this.state.playAgainstBot} onChange={() => this.setState({ playAgainstBot: !this.state.playAgainstBot })} />}
                        label={<Typography color="textPrimary">Play Against Bot</Typography>}
                    />
                    <InfoButton title="Play Against Bot">
                        When enabled, the bot will respond with a move after every human move is made
                    </InfoButton>
                </div>
                <div>
                    <FormControlLabel
                        control={<Checkbox checked={this.state.botIterative} onChange={() => this.setState({ botIterative: !this.state.botIterative })} />}
                        label={<Typography color="textPrimary">Bot Iterative Deepening</Typography>}
                    />
                    <InfoButton title="Bot Iterative Deepening">
                        This setting is recommended to be left on. When enabled, instead of forcing the bot to to search x moves ahead, the bot is given a set amount of time, determined by the slider, to search as far ahead as it can and make its move. If disabled, the bot will search ahead 6 moves, no matter how long it takes.
                    </InfoButton>
                </div>
                <div>
                    <Typography style={{ lineHeight: "30px", display: "inline-block" }} color="textPrimary">{`Max bot move time (s)`}</Typography>
                    <InfoButton title="Bot Max Move Time">
                        The time in seconds allotted for the bot to make its move each turn. 3 seconds is the recommended amount. The less time it has to search, the more likely it is to make a worse move.
                    </InfoButton>
                </div>
                <Slider
                    value={this.state.botMaxMoveTime}
                    disabled={this.state.waitingForMove}
                    onChange={this.updateBotMaxMoveTime}
                    valueLabelDisplay="auto"
                    step={0.5}
                    marks
                    min={0.5}
                    max={10}
                    style={{ marginLeft: "5px", marginTop: "-10px" }}
                />
                <div>
                    <Button disabled={this.state.waitingForMove || historyIndex != localHistory.length - 1} variant="contained" onClick={this.botMove}>Make a bot move</Button>
                    <InfoButton title="Bot Move">
                        When clicked, the bot will make a move for whoever's turn it currently is. The bottom fields will then be updated with information about the move. 'Last move depth' refers to how many moves ahead the bot searched, and 'last moves considered' displays the moves that the bot considered making during the search. For the first 5 moves of the game, the bot will try and play a 'book' move, which is a predefined opening move. If that is the case, the fields will indicate it
                    </InfoButton>
                </div>
                <br />
                <div>
                    <Button disabled={this.state.waitingForMove || historyIndex != localHistory.length - 1} variant="contained" onClick={this.undoLastMove}>Undo last move</Button>
                    <InfoButton title="Undo Last Move">
                        When clicked, the last move that was made will be undone as if it never happened
                    </InfoButton>
                </div>
                <br />
                <div>
                    <Button disabled={this.state.waitingForMove || historyIndex == 0} variant="contained" onClick={this.historyGoBack}>History go back</Button>
                    <InfoButton title="History Go Back">
                        When clicked or after pressing the left arrow key, the board will go back in the move history. Many actions are unavailable when viewing historical moves
                    </InfoButton>
                </div>
                <br />
                <div>
                    <Button disabled={this.state.waitingForMove || historyIndex == localHistory.length - 1} variant="contained" onClick={this.historyGoForward}>History go forward</Button>
                    <InfoButton title="History Go Forwards">
                        When clicked or after pressing the right arrow key, the board will go forwards in the move history. Many actions are unavailable when viewing historical moves
                    </InfoButton>
                </div>
                <br />
                <div>
                    <Button variant="contained" onClick={this.printPieceLocations}>Print Piece Locations</Button>
                    <InfoButton title="Print Piece Locations">
                        This is a debugging tool which will print all of the board indexes of each piece into the console
                    </InfoButton>
                </div>
                <br />
                <hr style={{ width: "100%" }}/>
                <br />
                <Typography style={{ lineHeight: "30px" }} color="textPrimary"><b>Last move color: </b>{`${whiteTurn ? "Black" : "White"}`}</Typography>
                <Typography style={{ lineHeight: "30px" }} color="textPrimary"><b>Last move time: </b>{`${Math.floor(moveTime)}ms`}</Typography>
                <Typography style={{ lineHeight: "30px" }} color="textPrimary"><b>Last move depth: </b>{`${searchDepth < 0 ? "Book move" : searchDepth + " ply"}`}</Typography>
                {searchDepth == -1 && <Typography style={{ lineHeight: "30px" }} color="textPrimary"><b>Opening: </b>{`${opening}`}</Typography> }
                <br />
                <hr style={{ width: "100%" }}/>
                <br />
                <Typography style={{ lineHeight: "30px" }} color="textPrimary">{`Last moves considered:`}</Typography>
                {
                    [...movesConsidered].reverse().map((e, i) => {
                        return (
                        <Paper key={i} style={{ padding: "5px", marginBottom: i == movesConsidered.length - 1 ? "0" : "10px" }}>
                            <Typography color="textSecondary">{this.debugMoveToText(e)}</Typography>
                        </Paper>
                        );
                    })
                }
            </div>
            <div style={{ margin: "auto", marginTop: 0 }}>
                <canvas
                    ref={this.canvasRef}
                    onMouseMove={this.onMouseMove}
                    onTouchMove={this.onTouchMove}
                    onMouseDown={this.onMouseDown}
                    onTouchStart={this.onTouchStart}
                    onMouseUp={this.onMouseUp}
                    onTouchEnd={this.onMouseUp}
                    width={this.state.cellSize * 8}
                    height={this.state.cellSize * 8}
                    style={{ touchAction: "none" }}
                />
                <EvaluationBar evaluation={this.state.currentEval} width={this.state.width} height={this.state.height} />
                <br />
                <br />
            </div>
        </div>
        );
    }
}