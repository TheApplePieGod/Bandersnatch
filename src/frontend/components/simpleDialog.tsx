import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogProps, DialogTitle } from "@material-ui/core";
import * as React from "react";
import * as theme from '../theme';

interface ConfirmDialogProps extends Omit<DialogProps, "onClose"> {
    onClose: () => void;
    title?: string;
    closeText?: string;
}

export const SimpleDialog = (props: ConfirmDialogProps) => {

    const { ...dialogProps } = props;

    return (
        <Dialog {...dialogProps}>
            {props.title &&
                <DialogTitle style={{ color: theme.PALETTE_BLACK }}>{props.title}</DialogTitle>
            }
            <DialogContent>
                {props.children}
            </DialogContent>
            <DialogActions>
                <Button onClick={props.onClose} color="primary">
                    {props.closeText ?? "Close"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}