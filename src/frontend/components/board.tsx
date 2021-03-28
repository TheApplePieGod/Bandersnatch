import { Button } from '@material-ui/core';
import React from 'react';
import { Piece } from "../../definitions";
import { Engine } from '../../engine/engine';

interface Props {

}

interface State {
    
}

export class Board extends React.Component<Props, State> {
    canvasRef: React.RefObject<HTMLCanvasElement>;
    images: Record<number, HTMLImageElement>;
    engine: Engine;
    cellSize = 150;
    animationFrameId = 0;
    draggingIndex = -1;
    relativeMousePos = { x: 0, y: 0 };
    debug = false;

    constructor(props: Props) {
        super(props);
        this.canvasRef = React.createRef<HTMLCanvasElement>();
        this.engine = new Engine();
        this.images = {};
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
    }

    componentWillUnmount = () => {
        window.cancelAnimationFrame(this.animationFrameId);
        window.removeEventListener("keydown", this.onKeyDown);
    }

    drawBoard = (ctx: CanvasRenderingContext2D) => {
        const { boardSize, board } = this.engine;
        const { cellSize, images, relativeMousePos } = this;

        let validMoveIndexes: number[] = [];
        for (let key in this.engine.allValidMoves) {
            for (let i = 0; i < this.engine.allValidMoves[key].length; i++) {
                validMoveIndexes.push(this.engine.allValidMoves[key][i].index);
            }
        }

        let xPos = 0;
        let yPos = 0;
        for (let y = 0; y < boardSize; y++) {
            for (let x = 0; x < boardSize; x++) {
                const boardIndex = (y * boardSize) + x;
                const piece = board[boardIndex];

                ctx.fillStyle = (x + y) % 2 == 1 ? '#403e38' : '#ded6c1';
                //if (this.debug && validMoveIndexes.includes(boardIndex))
                //    ctx.fillStyle = '#d8f51d';
                ctx.fillRect(xPos, yPos, cellSize, cellSize);
                
                if (piece != Piece.Empty) {
                    if (piece in images && images[piece].complete)
                        if (boardIndex != this.draggingIndex)
                            ctx.drawImage(images[piece], xPos, yPos, cellSize, cellSize);
                }
                if (this.debug) {
                    ctx.fillStyle = '#ff000d';
                    ctx.font = `${this.cellSize * 0.25}px arial`;
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
        ctx.font = `${this.cellSize * 0.5}px arial`;
        ctx.fillText(`White king index: ${this.engine.whiteKingIndex}`, xPos, yPos + cellSize);
        yPos += cellSize;
        ctx.fillText(`Black king index: ${this.engine.blackKingIndex}`, xPos, yPos + cellSize);
        yPos += cellSize;
        ctx.fillText(`Castle (W, B): ${this.engine.whiteCanCastle} / ${this.engine.blackCanCastle}`, xPos, yPos + cellSize);

        if (this.draggingIndex >= 0 && this.draggingIndex < board.length) {
            const piece = board[this.draggingIndex];
            if (piece != Piece.Empty)
                ctx.drawImage(images[piece], relativeMousePos.x - (cellSize * 0.5), relativeMousePos.y - (cellSize * 0.5), cellSize, cellSize);
        }
    }

    draw = (ctx: CanvasRenderingContext2D, frameCount: number) => {
        this.drawBoard(ctx);
    }

    getMouseBoardIndex = () => {
        const { relativeMousePos } = this;
        const x = Math.floor(relativeMousePos.x / this.cellSize);
        const y = Math.floor(relativeMousePos.y / this.cellSize);
        const finalIndex = x + (y * this.engine.boardSize);
        return finalIndex;
    }

    onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!this.canvasRef.current)
            return;

        const cRect = this.canvasRef.current.getBoundingClientRect();
        this.relativeMousePos.x = Math.round(e.clientX - cRect.left);
        this.relativeMousePos.y = Math.round(e.clientY - cRect.top);
    }

    onMouseDown = () => {
        this.draggingIndex = this.getMouseBoardIndex();
    }

    onMouseUp = () => {
        this.engine.attemptMove(this.draggingIndex, this.getMouseBoardIndex());
        this.draggingIndex = -1;
    }

    onKeyDown = (e: KeyboardEvent) => {
        if (e.key == "ArrowLeft")
            this.engine.stepBack();
        else if (e.key == "ArrowRight")
            this.engine.stepForward();
    }

    getAllMoves = () => {
        // this.engine.calculateAllPossibleMoves(4).then((number) => 
        //     console.log(number)
        // );
        //onsole.log(this.engine.calculateAllPossibleMoves(3));
        this.engine.findBestMove(3, 0, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
        console.log(this.engine.evalBestMove);
    }

    getPieceName = (piece: number) => {
        switch (piece) {
            case Piece.Pawn_W:
            case Piece.Pawn_B:
                return "Pawn";
            case Piece.Knight_W:
            case Piece.Knight_B:
                return "Knight";
            case Piece.Bishop_W:
            case Piece.Bishop_B:
                return "Bishop";
            case Piece.Rook_W:
            case Piece.Rook_B:
                return "Rook";
            case Piece.Queen_W:
            case Piece.Queen_B:
                return "Queen";
            case Piece.King_W:
            case Piece.King_B:
                return "King";
            default:
                return "N/A";
        }
    }

    printPieceLocations = () => {
        let finalString = "White:\n";
        const dictionaries = [this.engine.whitePieceLocations, this.engine.blackPieceLocations];

        for (let i = 0; i < dictionaries.length; i++) {
            if (i == 1)
                finalString += "\nBlack:\n";
            for (let key in dictionaries[i]) {
                const pieceIndex = parseInt(key);
                if (isNaN(pieceIndex))
                    continue;

                let line = `${this.getPieceName(pieceIndex)}: `;
                for (let j = 0; j < dictionaries[i][key].length; j++) {
                    line += dictionaries[i][key][j].toString() + ',';
                }

                finalString += line + '\n';
            }
        }
        console.log(finalString);
    }

    botMove = () => {
        if (this.engine.moveCount < 10)
           this.engine.evalBotMove(6);
        else if (this.engine.moveCount < 30)
            this.engine.evalBotMove(6);
        else
            this.engine.evalBotMove(7);
    }

    render = () => (
        <div>
            <Button onClick={this.botMove}>Bot Move</Button>
            <Button onClick={() => this.debug = !this.debug}>Toggle debug</Button>
            <Button onClick={this.getAllMoves}>Calc moves</Button>
            <Button onClick={this.printPieceLocations}>Print piece locations</Button>
            <canvas
                ref={this.canvasRef}
                onMouseMove={this.onMouseMove}
                onMouseDown={this.onMouseDown}
                onMouseUp={this.onMouseUp}
                width={this.cellSize * 8}
                height={this.cellSize * 10}
            />
        </div>
    );
}