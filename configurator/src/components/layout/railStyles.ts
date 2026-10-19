/** Row states from the DIGIT admin console: tinted when current, a lighter tint on hover. */
export const rowTone = (active: boolean) =>
  active ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-primary/5 hover:text-primary';

/**
 * The rail's own box: a column beside the page from md up, and below md an
 * off-canvas drawer, invisible while closed so its links leave the tab order.
 */
export const railClasses = (collapsed: boolean, drawerOpen: boolean) =>
  `${collapsed ? 'w-16' : 'w-64'} bg-sidebar border-r border-border flex flex-col transition-all duration-200 h-full fixed inset-y-0 left-0 z-50 md:static md:z-auto md:translate-x-0 md:visible md:shadow-none ${
    drawerOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full invisible'
  }`;
