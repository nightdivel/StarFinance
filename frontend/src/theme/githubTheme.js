// GitHub-like theme tokens and component overrides for Ant Design
// Reference colors adapted from GitHub Primer design tokens

export const githubLightTheme = {
  token: {
    colorPrimary: '#0969da',
    colorSuccess: '#1a7f37',
    colorWarning: '#9a6700',
    colorError: '#d1242f',
    colorInfo: '#0969da',

    colorLink: '#0969da',
    colorLinkHover: '#0757b3',
    colorLinkActive: '#054a99',

    colorBgBase: '#ffffff',
    colorBgLayout: '#f6f8fa',
    colorBgContainer: '#ffffff',
    colorBorder: '#d0d7de',
    colorSplit: '#d0d7de',

    colorText: '#24292f',
    colorTextSecondary: '#57606a',

    borderRadius: 8,
    fontSize: 14,
    fontFamily: `-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji`,
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      bodyBg: '#f6f8fa',
      siderBg: '#ffffff',
      headerBorderBottom: '1px solid #d0d7de',
    },
    Card: {
      colorBorderSecondary: '#d0d7de',
      colorBgContainer: '#ffffff',
      headerBg: '#f6f8fa',
    },
    Menu: {
      itemBorderRadius: 6,
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(9,105,218,0.12)',
      itemSelectedColor: '#0969da',
      itemHoverBg: 'rgba(9,105,218,0.08)',
    },
    Table: {
      headerBg: '#f6f8fa',
      headerColor: '#24292f',
      rowHoverBg: 'rgba(9,105,218,0.06)',
      borderColor: '#d0d7de',
    },
    Button: {
      borderRadius: 6,
      defaultBg: '#f6f8fa',
      defaultHoverBg: '#eef2f6',
      defaultBorderColor: '#d0d7de',
      defaultColor: '#24292f',
      primaryShadow: '0 1px 0 rgba(31,35,40,0.1)',
    },
    Tabs: {
      inkBarColor: '#0969da',
      itemSelectedColor: '#0969da',
      itemHoverColor: '#0757b3',
    },
    Tag: {
      defaultBg: '#eef2f6',
      defaultColor: '#24292f',
      defaultBorderColor: '#d0d7de',
      borderRadiusSM: 999,
    },
    Tooltip: {
      colorBgSpotlight: '#24292f',
      colorTextLightSolid: '#ffffff',
    },
    Dropdown: {
      colorBgElevated: '#ffffff',
      controlItemBgHover: '#eef2f6',
    },
    Typography: {
      colorText: '#24292f',
      colorTextSecondary: '#57606a',
    },
  },
};

export const githubDarkTheme = {
  token: {
    colorPrimary: '#58a6ff',
    colorSuccess: '#3fb950',
    colorWarning: '#d29922',
    colorError: '#f85149',
    colorInfo: '#58a6ff',

    colorLink: '#58a6ff',
    colorLinkHover: '#79c0ff',
    colorLinkActive: '#a5d6ff',

    colorBgBase: '#0d1117',
    colorBgLayout: '#0d1117',
    colorBgContainer: '#161b22',
    colorBorder: '#30363d',
    colorSplit: '#30363d',

    colorText: '#c9d1d9',
    colorTextSecondary: '#8b949e',

    borderRadius: 8,
    fontSize: 14,
    fontFamily: `-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,Apple Color Emoji,Segoe UI Emoji`,
  },
  components: {
    Layout: {
      headerBg: 'transparent',
      bodyBg: '#0d1117',
      siderBg: '#161b22',
      headerBorderBottom: '1px solid #30363d',
    },
    Card: {
      colorBorderSecondary: '#30363d',
      colorBgContainer: '#161b22',
      headerBg: '#161b22',
    },
    Menu: {
      itemBorderRadius: 6,
      itemBg: 'transparent',
      itemSelectedBg: 'rgba(88,166,255,0.16)',
      itemSelectedColor: '#58a6ff',
      itemHoverBg: 'rgba(88,166,255,0.10)',
    },
    Table: {
      headerBg: '#161b22',
      headerColor: '#c9d1d9',
      rowHoverBg: 'rgba(56,139,253,0.10)',
      borderColor: '#30363d',
    },
    Button: {
      borderRadius: 6,
      defaultBg: '#21262d',
      defaultHoverBg: '#30363d',
      defaultBorderColor: '#30363d',
      defaultColor: '#c9d1d9',
      primaryShadow: '0 0 0 rgba(0,0,0,0)',
    },
    Tabs: {
      inkBarColor: '#58a6ff',
      itemSelectedColor: '#58a6ff',
      itemHoverColor: '#79c0ff',
    },
    Tag: {
      defaultBg: '#21262d',
      defaultColor: '#c9d1d9',
      defaultBorderColor: '#30363d',
      borderRadiusSM: 999,
    },
    Tooltip: {
      colorBgSpotlight: '#161b22',
      colorTextLightSolid: '#c9d1d9',
    },
    Dropdown: {
      colorBgElevated: '#161b22',
      controlItemBgHover: '#21262d',
    },
    Typography: {
      colorText: '#c9d1d9',
      colorTextSecondary: '#8b949e',
    },
  },
};

export const getGithubTheme = (isDark) => (isDark ? githubDarkTheme : githubLightTheme);
