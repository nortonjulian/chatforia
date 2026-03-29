import { createTheme } from '@mantine/core';

/**
 * Chatforia Mantine theme
 * - Consumes CSS variables from styles/themes.css
 * - Do not hardcode brand hexes here; rely on tokens only
 * - Light uses warm flagship sweep; Dark uses cool sweep (set in themes.css)
 *
 * Note:
 * This version avoids nested selector objects like `&:hover`, `&:focus-visible`,
 * `&[data-disabled]`, etc. because your current setup is treating them like inline
 * styles and React is warning about them.
 */
export const chatforiaTheme = createTheme({
  colors: {
    foria: Array(10).fill('var(--accent)'),
  },

  primaryColor: 'foria',
  primaryShade: 5,
  defaultRadius: 'lg',
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',

  components: {
    Button: {
      defaultProps: {
        radius: 'xl',
        size: 'md',
        variant: 'filled',
      },
      styles: () => ({
        root: {
          position: 'relative',
          background: 'var(--cta-gradient)',
          color: 'var(--cta-label)',
          border: 'none',
          boxShadow: '0 6px 20px var(--shadow-accent)',
          transition: 'filter .15s ease, box-shadow .15s ease, transform .05s ease',
        },
      }),
      variants: {
        filled: () => ({
          root: {
            background: 'var(--cta-gradient)',
            color: 'var(--cta-label)',
            border: 'none',
            boxShadow: '0 6px 20px var(--shadow-accent)',
          },
        }),

        light: () => ({
          root: {
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
            boxShadow: 'none',
          },
        }),

        outline: () => ({
          root: {
            background: 'transparent',
            color: 'var(--accent)',
            border: '1.5px solid var(--accent)',
            boxShadow: 'none',
          },
        }),

        subtle: () => ({
          root: {
            background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
            boxShadow: 'none',
          },
        }),

        link: () => ({
          root: {
            background: 'transparent',
            color: 'var(--accent)',
            border: 'none',
            boxShadow: 'none',
            paddingInline: 0,
          },
        }),
      },
    },

    TextInput: {
      defaultProps: {
        size: 'md',
        variant: 'filled',
      },
      styles: () => ({
        input: {
          backgroundColor: 'var(--card)',
          color: 'var(--fg)',
          borderColor: 'var(--border)',
          boxShadow: 'none',
        },
        label: {
          color: 'var(--fg)',
        },
      }),
      variants: {
        filled: () => ({
          input: {
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
          },
        }),
      },
    },

    PasswordInput: {
      defaultProps: {
        size: 'md',
        variant: 'filled',
      },
      styles: () => ({
        input: {
          backgroundColor: 'var(--card)',
          color: 'var(--fg)',
          borderColor: 'var(--border)',
          boxShadow: 'none',
        },
        label: {
          color: 'var(--fg)',
        },
      }),
      variants: {
        filled: () => ({
          input: {
            backgroundColor: 'var(--card)',
            borderColor: 'var(--border)',
            color: 'var(--fg)',
          },
        }),
      },
    },

    Textarea: {
      defaultProps: {
        variant: 'filled',
      },
      styles: () => ({
        input: {
          backgroundColor: 'var(--card)',
          color: 'var(--fg)',
          borderColor: 'var(--border)',
          boxShadow: 'none',
        },
        label: {
          color: 'var(--fg)',
        },
      }),
    },

    Switch: {
      styles: () => ({
        track: {
          backgroundColor: 'var(--border)',
          border: '1px solid var(--border)',
        },
        thumb: {
          background: '#fff',
        },
      }),
    },

    Checkbox: {
      styles: () => ({
        icon: {
          color: '#fff',
        },
      }),
    },

    Radio: {
      styles: () => ({
        icon: {
          color: '#fff',
        },
      }),
    },

    ActionIcon: {
      defaultProps: {
        radius: 'xl',
        variant: 'light',
      },
      variants: {
        filled: () => ({
          root: {
            background: 'var(--cta-gradient)',
            color: 'var(--cta-label)',
            border: 'none',
            boxShadow: '0 6px 20px var(--shadow-accent)',
          },
        }),

        light: () => ({
          root: {
            background: 'transparent',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
          },
        }),
      },
      styles: () => ({
        root: {},
      }),
    },

    Badge: {
      variants: {
        filled: () => ({
          root: {
            background: 'var(--cta-gradient)',
            color: 'var(--cta-label)',
            border: 'none',
          },
        }),

        light: () => ({
          root: {
            background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
            color: 'var(--accent)',
            border: '1px solid var(--border)',
          },
        }),

        outline: () => ({
          root: {
            color: 'var(--accent)',
            border: '1px solid var(--accent)',
            background: 'transparent',
          },
        }),
      },
    },

    Tabs: {
      styles: () => ({
        tab: {
          color: 'var(--muted)',
        },
        indicator: {
          background: 'var(--accent)',
        },
        list: {
          borderColor: 'var(--border)',
        },
      }),
    },

    Anchor: {
      styles: () => ({
        root: {
          color: 'var(--accent)',
          textDecoration: 'none',
        },
      }),
    },

    Paper: {
      styles: () => ({
        root: {
          background: 'var(--card)',
          color: 'var(--fg)',
          borderColor: 'var(--border)',
        },
      }),
    },

    Card: {
      styles: () => ({
        root: {
          background: 'var(--card)',
          color: 'var(--fg)',
          borderColor: 'var(--border)',
        },
      }),
    },

    Modal: {
      styles: () => ({
        content: {
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
        },
        header: {
          background: 'var(--card)',
          color: 'var(--fg)',
          borderBottom: '1px solid var(--border)',
        },
      }),
    },

    Popover: {
      styles: () => ({
        dropdown: {
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
        },
      }),
    },

    Menu: {
      styles: () => ({
        dropdown: {
          background: 'var(--card)',
          color: 'var(--fg)',
          border: '1px solid var(--border)',
        },
        item: {
          background: 'transparent',
        },
        itemHovered: {
          background: 'color-mix(in oklab, var(--accent) 10%, transparent)',
        },
      }),
    },

    Tooltip: {
      styles: () => ({
        tooltip: {
          background: 'var(--fg)',
          color: 'var(--bg)',
          border: '1px solid var(--border)',
        },
        arrow: {
          background: 'var(--fg)',
        },
      }),
    },

    Loader: {
      styles: () => ({
        root: {
          color: 'var(--accent)',
        },
      }),
    },

    Progress: {
      styles: () => ({
        root: {
          background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
        },
        section: {
          background: 'var(--accent)',
        },
      }),
    },
  },
});