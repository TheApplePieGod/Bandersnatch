import { LinearProgress, withStyles, createStyles, Theme, Typography } from '@material-ui/core';
import React from 'react';
import * as ThemeConstants from '../theme';

interface Props {
    evaluation: number;
    width: number;
    height: number;
}

const StyledLinearProgress = withStyles((theme: Theme) =>
  createStyles({
    root: {
      borderRadius: 0,
    },
    colorPrimary: {
      backgroundColor: ThemeConstants.PALETTE_LIGHT_BLACK,
    },
    bar: {
      borderRadius: 0,
      transform: "rotate(90deg)",
      backgroundColor: ThemeConstants.PALETTE_WHITE,
    },
  }),
)(LinearProgress);

export const EvaluationBar = (props: Props) => {
    const normalizeEval = () => {
        return Math.max(Math.min(100, 50 + (props.evaluation / 20)), 0);
    }

    return (
        <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <StyledLinearProgress variant="determinate" style={{ width: "100%", height: props.width < 900 ? "25px" : "50px" }} value={normalizeEval()} />
            <Typography variant="h5" color="textPrimary">{`${props.evaluation > 0 ? '+' : ''}${Math.floor(Math.min(props.evaluation, 99999))}`}</Typography>
        </div>
    );
}