import { Typography, useTheme } from '@material-ui/core';
import React from 'react';
import * as theme from '../theme';
import { makeStyles } from "@material-ui/core";
import { useWindowDimensions } from './useWindowDimensions';
import { Board } from './board';

const useStyles = makeStyles(theme => ({
    content: {

    }
}));

export const Home = () => {
    const classes = useStyles();
    const theme = useTheme();
    const { height, width } = useWindowDimensions();

    return (
        <div>
            <Board />
        </div>
    );
}