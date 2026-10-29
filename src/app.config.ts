export default defineAppConfig({
  pages: [
    'pages/auth/index',
    'pages/legal/index',
    'pages/staff-application/index'
  ],
  subPackages: [
    {
      root: 'pages/customer',
      pages: [
        'order/index',
        'register/index',
        'pending/index',
        'cart/index',
        'orders/index',
        'returns/index',
        'profile/index',
        'settings/index'
      ]
    },
    {
      root: 'pages/stall',
      pages: [
        'listing/index',
        'receiving/index',
        'billing/index',
        'inventory/index',
        'customers/index',
        'staff/index',
        'profile/index'
      ]
    }
  ],
  window: {
    navigationStyle: 'custom',
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#f3eee2',
    navigationBarTitleText: '档口订货',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f3eee2'
  },
  lazyCodeLoading: 'requiredComponents'
})
