import { createTheme, alpha } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        primary: {
            main: '#2563eb',
            light: '#60a5fa',
            dark: '#1d4ed8',
        },
        secondary: {
            main: '#7c3aed',
            light: '#a78bfa',
            dark: '#5b21b6',
        },
        background: {
            default: '#000000',
            paper: '#09090b',
        },
        surface: {
            1: '#09090b',
            2: '#18181b',
            3: '#27272a',
            4: '#3f3f46',
        },
        text: {
            primary: '#ffffff',
            secondary: '#a1a1aa',
            disabled: '#71717a',
        },
        divider: '#27272a',
        success: {
            main: '#22c55e',
            dark: '#052e16',
        },
        error: {
            main: '#ef4444',
            dark: '#450a0a',
        },
        warning: {
            main: '#f59e0b',
        },
        info: {
            main: '#3b82f6',
        },
    },
    typography: {
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif",
        h1: {
            fontWeight: 700,
            letterSpacing: '-0.02em',
        },
        h2: {
            fontWeight: 700,
            letterSpacing: '-0.01em',
        },
        h3: {
            fontWeight: 600,
        },
        h4: {
            fontWeight: 600,
        },
        h5: {
            fontWeight: 600,
        },
        h6: {
            fontWeight: 600,
        },
        subtitle1: {
            color: '#a1a1aa',
        },
        subtitle2: {
            color: '#71717a',
        },
        body2: {
            color: '#a1a1aa',
        },
        button: {
            textTransform: 'none',
            fontWeight: 600,
        },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                body: {
                    backgroundColor: '#000000',
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#27272a #09090b',
                    '&::-webkit-scrollbar': {
                        width: 6,
                        height: 6,
                    },
                    '&::-webkit-scrollbar-track': {
                        background: '#09090b',
                    },
                    '&::-webkit-scrollbar-thumb': {
                        background: '#27272a',
                        borderRadius: 3,
                    },
                    '&::-webkit-scrollbar-thumb:hover': {
                        background: '#3f3f46',
                    },
                },
                '*': {
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#27272a #09090b',
                },
            },
        },
        MuiAppBar: {
            defaultProps: {
                elevation: 0,
            },
            styleOverrides: {
                root: {
                    backgroundColor: '#09090b',
                    borderBottom: '1px solid #27272a',
                },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: '#000000',
                    borderRight: '1px solid #18181b',
                },
            },
        },
        MuiPaper: {
            defaultProps: {
                elevation: 0,
            },
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    backgroundImage: 'none',
                },
            },
        },
        MuiButton: {
            defaultProps: {
                disableElevation: true,
            },
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    textTransform: 'none',
                    fontWeight: 600,
                    padding: '8px 20px',
                },
                contained: {
                    '&:hover': {
                        boxShadow: 'none',
                    },
                },
                outlined: {
                    borderColor: '#3f3f46',
                    color: '#d4d4d8',
                    '&:hover': {
                        borderColor: '#71717a',
                        backgroundColor: alpha('#ffffff', 0.04),
                    },
                },
            },
        },
        MuiIconButton: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    color: '#a1a1aa',
                    '&:hover': {
                        backgroundColor: '#27272a',
                        color: '#ffffff',
                    },
                },
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    fontWeight: 600,
                    fontSize: '0.7rem',
                    height: 24,
                    borderRadius: 6,
                },
            },
        },
        MuiTextField: {
            defaultProps: {
                variant: 'outlined',
                size: 'small',
            },
            styleOverrides: {
                root: {
                    '& .MuiOutlinedInput-root': {
                        backgroundColor: '#27272a',
                        borderRadius: 8,
                        '& fieldset': {
                            borderColor: '#3f3f46',
                        },
                        '&:hover fieldset': {
                            borderColor: '#71717a',
                        },
                        '&.Mui-focused fieldset': {
                            borderColor: '#2563eb',
                        },
                    },
                },
            },
        },
        MuiSelect: {
            styleOverrides: {
                root: {
                    backgroundColor: '#27272a',
                    borderRadius: 8,
                },
            },
        },
        MuiMenu: {
            styleOverrides: {
                paper: {
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: 12,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                },
            },
        },
        MuiMenuItem: {
            styleOverrides: {
                root: {
                    fontSize: '0.8125rem',
                    '&:hover': {
                        backgroundColor: '#27272a',
                    },
                    '&.Mui-selected': {
                        backgroundColor: alpha('#2563eb', 0.15),
                        '&:hover': {
                            backgroundColor: alpha('#2563eb', 0.25),
                        },
                    },
                },
            },
        },
        MuiLinearProgress: {
            styleOverrides: {
                root: {
                    backgroundColor: '#27272a',
                    borderRadius: 4,
                    height: 8,
                },
                bar: {
                    borderRadius: 4,
                },
            },
        },
        MuiTab: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 600,
                    minWidth: 'auto',
                    padding: '8px 16px',
                },
            },
        },
        MuiTable: {
            styleOverrides: {
                root: {
                    borderCollapse: 'separate',
                    borderSpacing: 0,
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: '1px solid #27272a',
                    padding: '10px 16px',
                },
                head: {
                    backgroundColor: '#000000',
                    color: '#a1a1aa',
                    fontWeight: 600,
                    fontSize: '0.8125rem',
                },
            },
        },
        MuiTableRow: {
            styleOverrides: {
                root: {
                    '&:hover': {
                        backgroundColor: alpha('#ffffff', 0.02),
                    },
                },
            },
        },
        MuiCheckbox: {
            styleOverrides: {
                root: {
                    color: '#3f3f46',
                    '&.Mui-checked': {
                        color: '#22c55e',
                    },
                },
            },
        },
        MuiTooltip: {
            styleOverrides: {
                tooltip: {
                    backgroundColor: '#09090b',
                    border: '1px solid #3f3f46',
                    color: '#e4e4e7',
                    fontSize: '0.7rem',
                    fontWeight: 500,
                    borderRadius: 4,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                },
                arrow: {
                    color: '#3f3f46',
                },
            },
        },
        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    '&.Mui-selected': {
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        '&:hover': {
                            backgroundColor: '#1d4ed8',
                        },
                    },
                    '&:hover': {
                        backgroundColor: '#18181b',
                    },
                },
            },
        },
    },
});

export default theme;
