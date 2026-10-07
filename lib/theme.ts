// Same palette as zafplay.com (app/globals.css there): near-black ink, blue to violet to pink gradient.
export const colors = {
  bg: '#07060d',
  card: '#11101c',
  cardAlt: '#1a1830',
  border: '#25233a',
  text: '#F4F5FB',
  muted: '#9A9EBB',
  primary: '#8b45c8',
  primaryAlt: '#5b8cff',
  blue: '#3b6cf0',
  violet: '#8b45c8',
  pink: '#f2507a',
  danger: '#FF5C6C',
  success: '#2ED3A0',
  warning: '#FFB84D',
};

export const gradient = [colors.blue, colors.violet, colors.pink] as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 24 };
