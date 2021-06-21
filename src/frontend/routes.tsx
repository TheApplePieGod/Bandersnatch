import { CssBaseline, MuiThemeProvider } from "@material-ui/core";
import React from "react";
import { Redirect, Route, Switch, useHistory, useParams, withRouter } from "react-router-dom";
import { Home } from "./components/home";
import { About } from "./components/about";
import { PageWrapper } from "./components/pageWrapper";
import { createApplicationTheme } from "./theme";

import './css/global.css'

export const Routes = () => {
    return (
        <MuiThemeProvider theme={createApplicationTheme()}>
            <PageWrapper>
                <Switch>
                    <Route exact path={'/'} component={About} />
                    <Route exact path={'/board'} component={Home} />
                    <Route path={'/'} render={() => <Redirect to={'/'} />} />
                </Switch>
            </PageWrapper>
        </MuiThemeProvider>
    );
}