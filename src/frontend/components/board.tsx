import { Button, FormControlLabel, Checkbox, Typography, Paper, Slider } from '@material-ui/core';
import bigInt from 'big-integer';
import React from 'react';
import { Piece, getPieceName, getPieceNameShort, EngineCommands, Sounds, EvalMove, EvalCommands, HistoricalBoard, DebugMoveOutput, notationToIndex, indexToNotation } from "../../definitions";
import EngineWorker from "worker-loader!../../engine/engine";
import EvalWorker from "worker-loader!../../engine/evaluation";
import { EvaluationBar } from './evaluationBar';

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
    whiteTurn: boolean;
}

export class Board extends React.Component<Props, State> {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    images: Record<number, HTMLImageElement>;
    engineWorker = new EngineWorker();
    evalWorker = new EvalWorker();

    evalTimeout: any = 0;
    nextBoardToEval: HistoricalBoard | undefined = undefined;

    localBoard: number[];
    animationFrameId = 0;
    draggingIndex = -1;
    relativeMousePos = { x: 0, y: 0 };
    boardSize = 8;
    botMoveMinTime = 1000;
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
            showNumbers: false,
            showValidMoves: false,
            waitingForMove: false,
            botMoveAutoplay: false,
            playAgainstBot: false,
            botIterative: true,
            currentEval: 0,
            localHistory: [],
            historyIndex: 0,
            botMaxMoveTime: 3
        };

        this.engineWorker.onmessage = this.handleMessage;
        this.evalWorker.onmessage = this.handleEvalMessage;
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
            case EngineCommands.RetrieveBoard:
                this.localBoard = e.data.board;
                this.setState({
                    localHistory: [{
                        lastMoveFrom: -1,
                        lastMoveTo: -1,
                        soundMade: 0,
                        validMoves: e.data.validMoves,
                        movesConsidered: [],
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
                        this.engineWorker.postMessage({ command: e.data.command });
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

        setTimeout(() => this.engineWorker.postMessage({ command: EngineCommands.RetrieveBoard }), 200);
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
            this.evalWorker.postMessage({ command: EvalCommands.UpdateState, board: this.nextBoardToEval });
            this.evalWorker.postMessage({ command: EvalCommands.Evaluate });
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
                    this.engineWorker.postMessage({ command: EngineCommands.AttemptMove, fromIndex: this.draggingIndex, toIndex: boardIndex });
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
            this.engineWorker.postMessage({ command: EngineCommands.HistoryGoForward });
        }
    }

    historyGoBack = () => {
        if (!this.state.waitingForMove) {
            this.engineWorker.postMessage({ command: EngineCommands.HistoryGoBack });
        }
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.key == "ArrowLeft")
            this.historyGoBack();
        else if (e.key == "ArrowRight")
            this.historyGoForward();
    }

    undoLastMove = () => {
        this.engineWorker.postMessage({ command: EngineCommands.UndoMove });
    }

    getAllMoves = () => {
        //console.log(this.engine.calculateAllPossibleMoves(6));
    }

    printPieceLocations = () => {
        this.engineWorker.postMessage({ command: EngineCommands.RetrievePieceLocations });
    }

    botMove = () => {
        if (!this.state.waitingForMove) {
            this.setState({ waitingForMove: true });
            this.engineWorker.postMessage({ command: this.state.botIterative ? EngineCommands.BotBestMoveIterative : EngineCommands.BotBestMove });
        }
    }

    debugMoveToText = (move: DebugMoveOutput) => {
        const from = getPieceNameShort(move.piece) + indexToNotation(move.from);
        const to = indexToNotation(move.to);
        return `${from} ${move.capture ? 'x' : "=>"} ${to} (${move.eval > 0 ? '+' : ''}${Math.floor(move.eval)})`;
    }

    updateBotMaxMoveTime = (e: React.ChangeEvent<{}>, value: number | number[]) => {
        if (!this.state.waitingForMove) {
            this.setState({ botMaxMoveTime: value as number });
            this.engineWorker.postMessage({ command: EngineCommands.UpdateMaxMoveTime, time: (value as number) * 1000 });
        }
    }

    render = () => {
        if (this.state.historyIndex == -1 || this.state.localHistory.length == 0)
            return <Typography color="textPrimary">Loading...</Typography>

        const { localHistory, historyIndex } = this.state;
        const { whiteTurn, moveTime, searchDepth, movesConsidered } = localHistory[historyIndex];
        return (
        <div style={{ display: "flex", flexDirection: this.state.width < 900 ? "column-reverse" : "row" }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: "20px", marginBottom: "50px", minWidth: "250px" }}>
                <FormControlLabel
                    control={<Checkbox checked={this.state.showNumbers} onChange={() => this.setState({ showNumbers: !this.state.showNumbers })} name="asd" />}
                    label={<Typography color="textPrimary">Show Grid Numbers</Typography>}
                />
                <FormControlLabel
                    control={<Checkbox checked={this.state.showValidMoves} onChange={() => this.setState({ showValidMoves: !this.state.showValidMoves })} />}
                    label={<Typography color="textPrimary">Show Legal Moves</Typography>}
                />
                <FormControlLabel
                    control={<Checkbox checked={this.state.botMoveAutoplay} onChange={() => this.setState({ botMoveAutoplay: !this.state.botMoveAutoplay })} />}
                    label={<Typography color="textPrimary">Bot Autoplay</Typography>}
                />
                <FormControlLabel
                    control={<Checkbox checked={this.state.playAgainstBot} onChange={() => this.setState({ playAgainstBot: !this.state.playAgainstBot })} />}
                    label={<Typography color="textPrimary">Play Against Bot</Typography>}
                />
                <FormControlLabel
                    control={<Checkbox checked={this.state.botIterative} onChange={() => this.setState({ botIterative: !this.state.botIterative })} />}
                    label={<Typography color="textPrimary">Bot Iterative Deepening</Typography>}
                />
                <Typography style={{ lineHeight: "30px" }} color="textPrimary">{`Max bot move time (seconds)`}</Typography>
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
                <Button disabled={this.state.waitingForMove || historyIndex != localHistory.length - 1} variant="contained" onClick={this.botMove}>Make a bot move</Button>
                <br />
                <Button disabled={this.state.waitingForMove || historyIndex != localHistory.length - 1} variant="contained" onClick={this.undoLastMove}>Undo last move</Button>
                <br />
                <Button disabled={this.state.waitingForMove || historyIndex == 0} variant="contained" onClick={this.historyGoBack}>History go back</Button>
                <br />
                <Button disabled={this.state.waitingForMove || historyIndex == localHistory.length - 1} variant="contained" onClick={this.historyGoForward}>History go forward</Button>
                <br />
                <Button variant="contained" onClick={this.printPieceLocations}>Print Piece Locations</Button>
                <br />
                <hr style={{ width: "100%" }}/>
                <br />
                <Typography style={{ lineHeight: "30px" }} color="textPrimary">{`Last move color: ${whiteTurn ? "Black" : "White"}`}</Typography>
                <Typography style={{ lineHeight: "30px" }} color="textPrimary">{`Last move time: ${Math.floor(moveTime)}ms`}</Typography>
                <Typography style={{ lineHeight: "30px" }} color="textPrimary">{`Last move depth: ${searchDepth} ply`}</Typography>
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