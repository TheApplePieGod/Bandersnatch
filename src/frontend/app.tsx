import React from 'react';
import ReactDom from 'react-dom';
import { createBrowserHistory } from "history";
import { Routes } from './routes';
import { Router } from 'react-router-dom';

const history = createBrowserHistory();

ReactDom.render(
    <Router history={history}>
        <Routes />
    </Router>
  , document.getElementById("root"));