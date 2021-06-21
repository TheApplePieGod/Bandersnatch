import { Typography, useTheme, Button } from '@material-ui/core';
import React from 'react';
import * as theme from '../theme';
import { makeStyles } from "@material-ui/core";
import { Board } from './board';

const useStyles = makeStyles(theme => ({
    content: {

    }
}));

export const Home = () => {
    return (
        <div>
            <Board />
        </div>
    );
}