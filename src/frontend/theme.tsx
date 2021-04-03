import { createMuiTheme, responsiveFontSizes } from "@material-ui/core/styles";
import memoizeOne from "memoize-one";

export const FONT_FAMILY: string = 'Quicksand,sans-serif';
export const PALETTE_RED: string = "#AC0E3E";
export const PALETTE_WHITE: string = "#FEFFF5";
export const PALETTE_DARK_WHITE: string = "#CECEC2";
export const PALETTE_BLACK: string = "#19181D";
export const PALETTE_LIGHT_BLACK: string = "#5B5765";

export const createApplicationTheme = memoizeOne(() => {
	let theme = createMuiTheme({
		palette: {
			type: "dark",
			primary: {
				main: PALETTE_RED,
			},
			secondary: {
				main: PALETTE_WHITE,
			},
			error: {
				main: PALETTE_RED,
			},
			text: {
				primary: PALETTE_WHITE,
				secondary: PALETTE_LIGHT_BLACK,
			}
		},
		typography: {
			fontFamily: FONT_FAMILY,
		},
		overrides: {
			MuiPaper: {
				root: {
					backgroundColor: PALETTE_WHITE
				}
			},
			// MuiCssBaseline: {
			// 	"@global": {
			// 		body: {
			// 			backgroundColor: PALETTE_BLACK
			// 		},
			// 	},
			// },
		}
	});

	theme = responsiveFontSizes(theme);
	return theme;
});