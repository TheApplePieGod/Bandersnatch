import React from 'react';
import { useHistory } from 'react-router';

interface _props {

}

export const PageWrapper: React.FunctionComponent<_props> = (props) => {
    const history = useHistory();

    return (
        <div>
            {props.children}
        </div>
    );
}