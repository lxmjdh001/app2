import { createTheme } from '@mui/material/styles';

export const appTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1565c0'
    },
    secondary: {
      main: '#7b1fa2'
    },
    background: {
      default: '#f5f7fb'
    }
  },
  shape: {
    borderRadius: 10
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 12px rgba(15, 23, 42, 0.08)'
        }
      }
    }
  }
});
