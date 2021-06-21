import { Typography, useTheme, Button } from '@material-ui/core';
import React from 'react';
import * as theme from '../theme';
import { makeStyles } from "@material-ui/core";
import { Link } from '@material-ui/core';
import { RouterProps, withRouter } from 'react-router-dom';
import { XYPlot, LineSeries, VerticalGridLines, HorizontalGridLines, XAxis, YAxis, Hint, DiscreteColorLegend } from 'react-vis';
import { useWindowDimensions } from './useWindowDimensions';

import 'react-vis/dist/style.css';

const useStyles = makeStyles(theme => ({
    openButton: {
        marginLeft: "1rem"
    }
}));

// 6 ply
const FIREFOX_JS_TIMING_DATA = [
    { x: 1, y: 0.247 },
    { x: 2, y: 0.480 },
    { x: 3, y: 1.275 },
    { x: 4, y: 0.630 },
    { x: 5, y: 1.130 },
    { x: 6, y: 1.720 },
    { x: 7, y: 2.000 },
    { x: 8, y: 0.640 },
    { x: 9, y: 0.900 },
    { x: 10, y: 1.100 }
];

const FIREFOX_WASM_TIMING_DATA = [
    { x: 1, y: 0.082 },
    { x: 2, y: 0.150 },
    { x: 3, y: 0.415 },
    { x: 4, y: 0.210 },
    { x: 5, y: 0.375 },
    { x: 6, y: 0.580 },
    { x: 7, y: 0.630 },
    { x: 8, y: 0.230 },
    { x: 9, y: 0.270 },
    { x: 10, y: 0.340 }
];

const CHROME_JS_TIMING_DATA = [
    { x: 1, y: 0.140 },
    { x: 2, y: 0.240 },
    { x: 3, y: 0.600 },
    { x: 4, y: 0.300 },
    { x: 5, y: 0.520 },
    { x: 6, y: 0.780 },
    { x: 7, y: 0.910 },
    { x: 8, y: 0.300 },
    { x: 9, y: 0.400 },
    { x: 10, y: 0.495 }
];

const CHROME_WASM_TIMING_DATA = [
    { x: 1, y: 0.082 },
    { x: 2, y: 0.150 },
    { x: 3, y: 0.430 },
    { x: 4, y: 0.210 },
    { x: 5, y: 0.375 },
    { x: 6, y: 0.580 },
    { x: 7, y: 0.650 },
    { x: 8, y: 0.220 },
    { x: 9, y: 0.270 },
    { x: 10, y: 0.360 }
];

const _About = (props: RouterProps) => {
    const classes = useStyles();
    const { height, width } = useWindowDimensions();

    return (
        <React.Fragment>
            <div style={{ width: "90%", maxWidth: "1000px", margin: "auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <Typography variant="h4" style={{ color:theme.PALETTE_LIGHT_BLACK }}>Welcome to Bandersnatch!</Typography>
                    <Button variant="contained" onClick={() => props.history.push("/board")} className={classes.openButton}>Open Board</Button>
                </div>
                <hr style={{ width: "400px" }} />
                <Typography variant="body1" color="textPrimary" style={{ marginBottom: "2rem" }}>
                    Bandersnatch is an open-source chess engine written by <Link href="https://github.com/TheApplePieGod">TheApplePieGod</Link>. <br /><br />
                    To get started, click the 'open board' button and start dragging around pieces. Explore all the options and feel free to view the brief description of each. The bar underneath the board is 
                    the bot's evaluation of the current position (positive being white advantage and negative being black advantage). The evaluation takes about 3-5 seconds to update each time a move is made.
                </Typography>
                <Typography variant="h5" style={{ color:theme.PALETTE_LIGHT_BLACK }}>About The Project</Typography>
                <hr style={{ width: "150px" }} />
                <Typography variant="body1" color="textPrimary" style={{ marginBottom: "2rem" }}>
                    The original intention for this project was to write a simple chess AI engine in JavaScript, but it turned into more than that. I am continually finding optimizations in the engine and improvements to the
                    algorithm, and I hope to add rudimentary multiplayer functionality in the future along with some other cool features. The site and engine also work on mobile, which is always a cool characteristic.
                </Typography>
                <Typography variant="h5" style={{ color:theme.PALETTE_LIGHT_BLACK }}>About The Engine</Typography>
                <hr style={{ width: "150px" }} />
                <Typography variant="body1" color="textPrimary">
                    Some of the various algorithms and concepts built into the Bandersnatch engine:
                        <Link href="https://www.chessprogramming.org/Minimax"> Minimax</Link> searching,
                        <Link href="https://www.chessprogramming.org/Alpha-Beta"> Alpha-Beta</Link> pruning,
                        <Link href="https://www.chessprogramming.org/Quiescence_Search"> Quiescence</Link> searching,
                        <Link href="https://www.chessprogramming.org/Move_Ordering"> Move ordering</Link>,
                        and others. The Minimax algorithm requires the use of a static evaluation function, which takes a board with any position and gives it a score via a set of rules. I plan to improve this algorithm in
                        the future, but as of now, the evaluation function takes the following things into consideration: useful piece squares, piece point values, and some endgame algorithms involving kings.  
                    <br /><br />
                    The Bandersnatch engine actually has two counterparts: a JavaScript counterpart and a <Link href="https://webassembly.org/">WebAssembly</Link> counterpart. Both are functionally identical, but the WebAssembly version
                    is written in and compiled from the <Link href="https://www.rust-lang.org/">Rust</Link> programming language. In theory, the WebAssembly platform should be faster, but I wanted to see if that was actually the case,
                    so I compiled some experimental data and came up with the results below. <br /><br />
                    First 10 moves from the base position at depth 6 (processor: Ryzen 5600x, memory: DDR4 2200 MHz)
                </Typography>
                <XYPlot height={400} width={Math.min(width - 100, 1000)} style={{ fontFamily: theme.FONT_FAMILY }}>
                    <VerticalGridLines
                        style={{ stroke: '#646466' }}
                    />
                    <HorizontalGridLines
                        style={{ stroke: '#646466' }}
                    />
                    <LineSeries
                        data={FIREFOX_JS_TIMING_DATA}
                        color="red"
                        curve={'curveMonotoneX'}
                    />
                    <LineSeries
                        data={FIREFOX_WASM_TIMING_DATA}
                        color="yellow"
                        curve={'curveMonotoneX'}
                    />
                    <LineSeries
                        data={CHROME_JS_TIMING_DATA}
                        color="green"
                        curve={'curveMonotoneX'}
                    />
                    <LineSeries
                        data={CHROME_WASM_TIMING_DATA}
                        color="blue"
                        curve={'curveMonotoneX'}
                    />
                    <XAxis
                        title="Move #"
                        style={{ fontSize: "1rem", fill: theme.PALETTE_WHITE }}
                        tickValues={[1,2,3,4,5,6,7,8,9,10]}
                        tickFormat={(value: any) => {
                            return Number(value).toString();
                        }}
                    />
                    <YAxis
                        title="Time (seconds)"
                        style={{ fontSize: "1rem", fill: theme.PALETTE_WHITE }}
                    />
                    <DiscreteColorLegend
                        orientation={"vertical"}
                        items={[
                            { title: "Firefox (JS)", color: "red" },
                            { title: "Firefox (WASM)", color: "yellow" },
                            { title: "Chrome (JS)", color: "green" },
                            { title: "Chrome (WASM)", color: "blue" }
                        ]}
                    />
                </XYPlot>
                <Typography variant="body1" color="textPrimary" style={{ marginTop: "12rem", marginBottom: "3rem" }}>
                    In conclusion, porting the engine to WebAssembly was well worth it, providing significant improvements from the Firefox JavaScript engine and respectible improvements from the Chrome V8 engine.
                    The engine being used can be changed via the settings dialog on the board page, so feel free to experiment with the differences yourself.
                </Typography>
            </div>
        </React.Fragment>
    );
}

export const About = withRouter(_About);