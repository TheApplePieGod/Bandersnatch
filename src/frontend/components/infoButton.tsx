import { makeStyles, Typography, Button, Link, IconButton } from "@material-ui/core"
import React from "react"
import * as theme from '../theme';
import { SimpleDialog } from "./simpleDialog";
import InfoIcon from '@material-ui/icons/Info';

const useStyles = makeStyles({
    content: {

    },
});

interface _props {
    title: string;
}

export const InfoButton: React.FunctionComponent<_props> = (props) => {
    const [open, setOpen] = React.useState(false);

    return (
        <React.Fragment>
            <IconButton onClick={() => setOpen(true)}><InfoIcon /></IconButton>
            <SimpleDialog open={open} title={props.title} onClose={() => setOpen(false)} style={{ color: theme.PALETTE_BLACK }}>
                <Typography color="textSecondary">{props.children}</Typography>
            </SimpleDialog>
        </React.Fragment>
    );
}