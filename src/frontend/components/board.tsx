import { Button, FormControlLabel, Checkbox, Typography } from '@material-ui/core';
import bigInt from 'big-integer';
import React from 'react';
import { Piece, getPieceName, EngineCommands, Sounds } from "../../definitions";
import EngineWorker from "worker-loader!../../engine/engine";

interface Props {

}

interface State {
    width: number;
    height: number;
    cellSize: number;
    showNumbers: boolean;
    showValidMoves: boolean;
}

export class Board extends React.Component<Props, State> {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    images: Record<number, HTMLImageElement>;
    engineWorker = new EngineWorker();
    localBoard: number[];
    localValidMoves: Record<number, number[]> = {};
    lastMoveFrom = -1;
    lastMoveTo = -1;
    animationFrameId = 0;
    draggingIndex = -1;
    relativeMousePos = { x: 0, y: 0 };
    boardScaleFactor = 0.9;
    boardSize = 8;
    waitingForMove = false;

    constructor(props: Props) {
        super(props);
        this.canvasRef = React.createRef<HTMLCanvasElement>();
        this.localBoard = new Array(64);
        this.images = {};
        this.state = {
            width: window.innerWidth,
            height: window.innerHeight,
            cellSize: Math.floor(Math.min(window.innerWidth * this.boardScaleFactor, window.innerHeight * this.boardScaleFactor) / 8),
            showNumbers: false,
            showValidMoves: false,
        };

        this.engineWorker.onmessage = this.handleMessage;
    }

    playSound = (sound: number) => {
        switch (sound) {
            case Sounds.PieceMoved:
            {
                const audio = new Audio("sounds/move.wav");
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

    handleMessage = (e: MessageEvent) => {
        switch (e.data.command) {
            case EngineCommands.RetrieveBoard:
                this.localBoard = e.data.board;
                this.localValidMoves = e.data.validMoves;
                break;
            case EngineCommands.AttemptMove:
                if (e.data.board.length > 0) {
                    this.localBoard = e.data.board;
                    this.localValidMoves = e.data.validMoves;
                    this.lastMoveFrom = e.data.from;
                    this.lastMoveTo = e.data.to;
                    if (e.data.inCheck)
                        this.playSound(Sounds.Checked);
                    else {
                        if (e.data.captured)
                            this.playSound(Sounds.PieceCaptured);
                        else if (e.data.castled)
                            this.playSound(Sounds.Castled);
                        else
                            this.playSound(Sounds.PieceMoved);
                    }
                } else {
                    this.playSound(Sounds.IllegalMove);
                }
                this.draggingIndex = -1;

                break;
            case EngineCommands.HistoryGoBack:
                this.localBoard = e.data.board;
                break;
            case EngineCommands.HistoryGoForward:
                this.localBoard = e.data.board;
                break;
            case EngineCommands.BotBestMove:
                this.localBoard = e.data.board;
                this.localValidMoves = e.data.validMoves;
                this.lastMoveFrom = e.data.from;
                this.lastMoveTo = e.data.to;
                this.waitingForMove = false;
                if (e.data.inCheck)
                    this.playSound(Sounds.Checked);
                else {
                    if (e.data.captured)
                        this.playSound(Sounds.PieceCaptured);
                    else if (e.data.castled)
                        this.playSound(Sounds.Castled);
                    else
                        this.playSound(Sounds.PieceMoved);
                }

                break;
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

    componentDidMount = () => {
        this.init();
        this.startRendering();
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("resize", this.handleResize);
    }

    componentWillUnmount = () => {
        window.cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("resize", this.handleResize);
    }

    drawBoard = (ctx: CanvasRenderingContext2D) => {
        const { boardSize, localBoard, images, relativeMousePos } = this;
        const { cellSize } = this.state;

        let xPos = 0;
        let yPos = 0;
        for (let y = 0; y < boardSize; y++) {
            for (let x = 0; x < boardSize; x++) {
                const boardIndex = (y * boardSize) + x;
                const piece = localBoard[boardIndex];

                ctx.fillStyle = (x + y) % 2 == 1 ? '#403e38' : '#ded6c1';
                ctx.fillRect(xPos, yPos, cellSize, cellSize);

                if (boardIndex == this.lastMoveFrom || boardIndex == this.lastMoveTo) {
                    ctx.fillStyle = '#f57b4270';
                    ctx.fillRect(xPos, yPos, cellSize, cellSize);
                }

                if (this.state.showValidMoves) {
                    if (this.draggingIndex in this.localValidMoves && this.localValidMoves[this.draggingIndex].includes(boardIndex)) {
                        ctx.fillStyle = '#d8f51d70';
                        ctx.fillRect(xPos, yPos, cellSize, cellSize);
                    }
                }
                
                if (piece != Piece.Empty) {
                    if (piece in images && images[piece].complete)
                        if (boardIndex != this.draggingIndex)
                            ctx.drawImage(images[piece], xPos, yPos, cellSize, cellSize);
                }
                if (this.state.showNumbers) {
                    ctx.fillStyle = '#ff000d';
                    ctx.font = `${this.state.cellSize * 0.25}px arial`;
                    ctx.fillText(boardIndex.toString(), xPos, yPos + cellSize);
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

    handleResize = () => {
        const { innerWidth: width, innerHeight: height } = window;
        this.setState({
            width: width,
            height: height,
            cellSize: Math.floor(Math.min(width * this.boardScaleFactor, height * this.boardScaleFactor) / 8)
        });
    }

    onMouseDown = () => {
        const index = this.getMouseBoardIndex();
        if (this.localBoard[index] != Piece.Empty)
            this.draggingIndex = index; 
    }

    onMouseUp = () => {
        if (this.draggingIndex != -1) {
            if (!this.waitingForMove) {
                this.engineWorker.postMessage({ command: EngineCommands.AttemptMove, fromIndex: this.draggingIndex, toIndex: this.getMouseBoardIndex() });
            } else {
                this.draggingIndex = -1;
                this.playSound(Sounds.IllegalMove);
            }
        } 
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.key == "ArrowLeft")
            this.engineWorker.postMessage({ command: EngineCommands.HistoryGoBack });
        else if (e.key == "ArrowRight")
            this.engineWorker.postMessage({ command: EngineCommands.HistoryGoForward });
    }

    getAllMoves = () => {
        //console.log(this.engine.calculateAllPossibleMoves(6));
    }

    printPieceLocations = () => {
        let finalString = "White:\n";
        // const dictionaries = [this.engine.whitePieceLocations, this.engine.blackPieceLocations];

        // for (let i = 0; i < dictionaries.length; i++) {
        //     if (i == 1)
        //         finalString += "\nBlack:\n";
        //     for (let key in dictionaries[i]) {
        //         const pieceIndex = parseInt(key);
        //         if (isNaN(pieceIndex))
        //             continue;

        //         let line = `${getPieceName(pieceIndex)}: `;
        //         for (let j = 0; j < dictionaries[i][key].length; j++) {
        //             line += dictionaries[i][key][j].toString() + ',';
        //         }

        //         finalString += line + '\n';
        //     }
        // }
        // console.log(finalString);
    }

    botMove = () => {
        if (!this.waitingForMove) {
            this.waitingForMove = true;
            this.engineWorker.postMessage({ command: EngineCommands.BotBestMove });
        }
    }

    render = () => (
        <div style={{ display: "flex" }}>
            <div style={{ display: "flex", flexDirection: "column", marginRight: "20px" }}>
                <FormControlLabel
                    control={<Checkbox checked={this.state.showNumbers} onChange={() => this.setState({ showNumbers: !this.state.showNumbers })} name="asd" />}
                    label={<Typography color="textPrimary">Show Grid Numbers</Typography>}
                />
                <FormControlLabel
                    control={<Checkbox checked={this.state.showValidMoves} onChange={() => this.setState({ showValidMoves: !this.state.showValidMoves })} />}
                    label={<Typography color="textPrimary">Show Legal Moves</Typography>}
                />
                <Button variant="contained" onClick={this.botMove}>Make a bot move</Button>
            </div>
            <canvas
                ref={this.canvasRef}
                onMouseMove={this.onMouseMove}
                onMouseDown={this.onMouseDown}
                onMouseUp={this.onMouseUp}
                width={Math.min(this.state.width * this.boardScaleFactor, this.state.height * this.boardScaleFactor)}
                height={Math.min(this.state.width * this.boardScaleFactor, this.state.height * this.boardScaleFactor)}
            />
        </div>
    );
}