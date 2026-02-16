// Message types used across extension layers
export const MSG = {
  // Interceptor -> Content script
  INTERCEPTED: 'XPRTR_INTERCEPTED',

  // Content script -> Background
  DATA_CAPTURED: 'XPRTR_DATA_CAPTURED',
  PAGE_CHANGED: 'XPRTR_PAGE_CHANGED',
  GET_SESSION: 'XPRTR_GET_SESSION',
  START_AUTOSCROLL: 'XPRTR_START_AUTOSCROLL',
  STOP_AUTOSCROLL: 'XPRTR_STOP_AUTOSCROLL',
  AUTOSCROLL_STATUS: 'XPRTR_AUTOSCROLL_STATUS',

  // Background -> Content script / Popup
  SESSION_UPDATE: 'XPRTR_SESSION_UPDATE',
  AUTOSCROLL_STATE: 'XPRTR_AUTOSCROLL_STATE',

  // Popup -> Background
  EXPORT_CSV: 'XPRTR_EXPORT_CSV',
  EXPORT_JSON: 'XPRTR_EXPORT_JSON',
  GET_STATUS: 'XPRTR_GET_STATUS',
  CLEAR_SESSION: 'XPRTR_CLEAR_SESSION',
  GET_HISTORY: 'XPRTR_GET_HISTORY',
  GET_SAVED_LISTS: 'XPRTR_GET_SAVED_LISTS',
  SAVE_LIST: 'XPRTR_SAVE_LIST',
  DELETE_SAVED_LIST: 'XPRTR_DELETE_SAVED_LIST',
  COMPARE_LISTS: 'XPRTR_COMPARE_LISTS',
  SEARCH_USERS: 'XPRTR_SEARCH_USERS',
  GET_SETTINGS: 'XPRTR_GET_SETTINGS',
  UPDATE_SETTINGS: 'XPRTR_UPDATE_SETTINGS',

  // Filtering
  FILTER_USERS: 'XPRTR_FILTER_USERS',
  EXPORT_FILTERED_CSV: 'XPRTR_EXPORT_FILTERED_CSV',
  EXPORT_FILTERED_JSON: 'XPRTR_EXPORT_FILTERED_JSON',

  // Follow queue
  SET_FOLLOW_QUEUE: 'XPRTR_SET_FOLLOW_QUEUE',
  GET_FOLLOW_QUEUE: 'XPRTR_GET_FOLLOW_QUEUE',
  UPDATE_FOLLOW_QUEUE: 'XPRTR_UPDATE_FOLLOW_QUEUE',
};

// URL patterns for detecting page type
export const PATTERNS = {
  FOLLOWERS: /^https:\/\/(x|twitter)\.com\/([^/]+)\/followers\/?$/,
  FOLLOWING: /^https:\/\/(x|twitter)\.com\/([^/]+)\/following\/?$/,
  GRAPHQL_FOLLOWERS: /\/i\/api\/graphql\/[^/]+\/Followers/,
  GRAPHQL_FOLLOWING: /\/i\/api\/graphql\/[^/]+\/Following/,
};

// Storage keys
export const STORAGE_KEYS = {
  CURRENT_SESSION: 'currentSession',
  HISTORY: 'history',
  SAVED_LISTS: 'savedLists',
  SETTINGS: 'settings',
};

// Default settings
export const DEFAULT_SETTINGS = {
  autoScroll: true,
  scrollDelay: 2000,
  staleThreshold: 5,
  exportFields: [
    'username', 'displayName', 'bio', 'followersCount',
    'followingCount', 'verified', 'joinDate', 'location', 'profileUrl',
  ],
};

// Filter presets - keyword groups for common industries
export const FILTER_PRESETS = {
  'IT / Tech': [
    'developer', 'engineer', 'software', 'devops', 'sre', 'cloud',
    'infrastructure', 'sysadmin', 'backend', 'frontend', 'fullstack',
    'full-stack', 'programming', 'coder', 'architect', 'tech lead',
    'cto', 'cio', 'vp engineering', 'data engineer', 'ml ', 'machine learning',
    'ai ', 'artificial intelligence', 'deep learning', 'python', 'javascript',
    'typescript', 'golang', 'rust', 'java ', 'kubernetes', 'k8s', 'docker',
    'aws', 'azure', 'gcp', 'terraform', 'linux', 'open source',
    'web dev', 'mobile dev', 'ios dev', 'android dev', 'react', 'node',
    'database', 'sql', 'nosql', 'api', 'microservices',
  ],
  'Cybersecurity': [
    'security', 'infosec', 'cybersecurity', 'cyber', 'pentester',
    'penetration test', 'red team', 'blue team', 'soc ', 'threat',
    'malware', 'vulnerability', 'ciso', 'appsec', 'devsecops',
    'incident response', 'forensic', 'osint', 'bug bounty', 'hacker',
    'offensive sec', 'defensive sec', 'compliance', 'grc',
  ],
  'Data / Analytics': [
    'data scientist', 'data analyst', 'analytics', 'big data',
    'data engineering', 'business intelligence', 'tableau', 'power bi',
    'statistics', 'machine learning', 'nlp', 'computer vision',
  ],
  'Design / UX': [
    'designer', 'ux ', 'ui ', 'product design', 'ux research',
    'user experience', 'figma', 'interaction design', 'design system',
  ],
};

// CSV field mappings
export const CSV_FIELDS = {
  username: 'Username',
  displayName: 'Display Name',
  bio: 'Bio',
  followersCount: 'Followers',
  followingCount: 'Following',
  verified: 'Verified',
  joinDate: 'Joined',
  location: 'Location',
  profileUrl: 'Profile URL',
  userId: 'User ID',
  profileImageUrl: 'Profile Image URL',
};
