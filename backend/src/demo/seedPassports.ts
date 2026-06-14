import { ProductPassport } from '../models/ProductPassport';

interface PassportSeed {
  passportId: string;
  qrCodeValue: string;
  sku: string;
  productName: string;
  category: string;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  currentOwner: string;
  currentLocation: { city: string; hub: string };
  currentStatus: 'in_transit' | 'at_hub' | 'delivered' | 'return_initiated' | 'routed' | 'reallocated';
  eligibilityScore: number;
  reservedBuyer: { name: string; city: string; distance: string; score: number } | null;
  ownershipHistory: Array<{ owner: string; from: string; to: string; date: string }>;
  returnHistory: Array<{ reason: string; date: string; condition: string }>;
  routingHistory: Array<{ event: string; timestamp: string; details: string; status: 'completed' | 'active' | 'pending' }>;
}

const PRODUCTS = [
  { name: 'iPhone 15 Pro', sku: 'SKU-ELE-10001', category: 'Electronics' },
  { name: 'Samsung Galaxy S24', sku: 'SKU-ELE-10002', category: 'Electronics' },
  { name: 'AirPods Pro', sku: 'SKU-ELE-10003', category: 'Electronics' },
  { name: 'MacBook Air M3', sku: 'SKU-ELE-10004', category: 'Electronics' },
  { name: 'Sony WH-1000XM5', sku: 'SKU-AUD-10005', category: 'Audio' },
  { name: 'Apple Watch Ultra', sku: 'SKU-ELE-10006', category: 'Electronics' },
  { name: 'iPad Air', sku: 'SKU-ELE-10007', category: 'Electronics' },
  { name: 'Logitech MX Keys', sku: 'SKU-ACC-10008', category: 'Accessories' },
  { name: 'Dell Monitor 27"', sku: 'SKU-ELE-10009', category: 'Electronics' },
  { name: 'JBL Flip 6', sku: 'SKU-AUD-10010', category: 'Audio' },
  { name: 'Kindle Paperwhite', sku: 'SKU-ELE-10011', category: 'Electronics' },
  { name: 'Dyson V15', sku: 'SKU-HOM-10012', category: 'Home' },
  { name: 'Bose QC45', sku: 'SKU-AUD-10013', category: 'Audio' },
  { name: 'Google Pixel 8', sku: 'SKU-ELE-10014', category: 'Electronics' },
  { name: 'OnePlus 12', sku: 'SKU-ELE-10015', category: 'Electronics' },
  { name: 'Boat Rockerz 550', sku: 'SKU-AUD-10016', category: 'Audio' },
  { name: 'Fire TV Stick', sku: 'SKU-ELE-10017', category: 'Electronics' },
  { name: 'Echo Dot 5th Gen', sku: 'SKU-ELE-10018', category: 'Electronics' },
  { name: 'Mi Power Bank', sku: 'SKU-ACC-10019', category: 'Accessories' },
  { name: 'Noise ColorFit', sku: 'SKU-ELE-10020', category: 'Electronics' },
];

const CITIES = ['Bhopal', 'Indore', 'Delhi', 'Mumbai', 'Pune', 'Bangalore', 'Hyderabad'];

const HUBS: Record<string, string> = {
  Bhopal: 'HUB-BPL-01',
  Indore: 'HUB-IDR-01',
  Delhi: 'HUB-DEL-03',
  Mumbai: 'HUB-MUM-02',
  Pune: 'HUB-PNE-01',
  Bangalore: 'HUB-BLR-02',
  Hyderabad: 'HUB-HYD-01',
};

const OWNERS = [
  'Priya Sharma', 'Rajesh Kumar', 'Anita Verma', 'Vikram Patel', 'Sneha Singh',
  'Amit Reddy', 'Kavita Gupta', 'Suresh Nair', 'Deepa Joshi', 'Arjun Mehta',
  'Meera Iyer', 'Rohit Choudhary', 'Pooja Mishra', 'Arun Bhat', 'Nisha Rao',
  'Kiran Desai', 'Sanjay Pillai', 'Rani Malhotra', 'Manoj Banerjee', 'Lakshmi Kulkarni',
];

const BUYERS = [
  { name: 'Gaurav Shukla', city: 'Bhopal', distance: '12 km', score: 94 },
  { name: 'Neha Tiwari', city: 'Indore', distance: '8 km', score: 91 },
  { name: 'Rahul Verma', city: 'Delhi', distance: '15 km', score: 88 },
  { name: 'Divya Patel', city: 'Mumbai', distance: '6 km', score: 96 },
  { name: 'Sachin Mishra', city: 'Pune', distance: '22 km', score: 85 },
  { name: 'Anjali Sharma', city: 'Bangalore', distance: '10 km', score: 92 },
  { name: 'Vivek Reddy', city: 'Hyderabad', distance: '18 km', score: 87 },
  { name: 'Shruti Gupta', city: 'Bhopal', distance: '5 km', score: 97 },
  { name: 'Aditya Nair', city: 'Indore', distance: '14 km', score: 89 },
  { name: 'Komal Singh', city: 'Delhi', distance: '9 km', score: 93 },
];

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function generateRoutingHistory(status: string, index: number): Array<{ event: string; timestamp: string; details: string; status: 'completed' | 'active' | 'pending' }> {
  type HistoryEntry = { event: string; timestamp: string; details: string; status: 'completed' | 'active' | 'pending' };
  const baseHistory: HistoryEntry[] = [
    { event: 'Order Placed', timestamp: daysAgoISO(14), details: 'Original order placed by customer', status: 'completed' },
    { event: 'Shipped from Warehouse', timestamp: daysAgoISO(12), details: 'Package dispatched from fulfillment center', status: 'completed' },
    { event: 'Delivered to Customer', timestamp: daysAgoISO(10), details: 'Successfully delivered to original buyer', status: 'completed' },
    { event: 'Return Initiated', timestamp: daysAgoISO(8), details: 'Customer initiated return request', status: 'completed' },
    { event: 'Picked Up for Return', timestamp: daysAgoISO(7), details: 'Return pickup completed by courier', status: 'completed' },
  ];

  if (status === 'return_initiated') {
    return [
      ...baseHistory.slice(0, 4),
      { event: 'Awaiting Pickup', timestamp: daysAgoISO(6), details: 'Pickup scheduled for return', status: 'active' },
      { event: 'AI Analysis Pending', timestamp: '', details: 'Waiting for condition assessment', status: 'pending' },
    ];
  }

  if (status === 'at_hub') {
    return [
      ...baseHistory,
      { event: 'Arrived at Hub', timestamp: daysAgoISO(5), details: `Package received at ${HUBS[CITIES[index % CITIES.length]!]}`, status: 'completed' },
      { event: 'AI Analysis Complete', timestamp: daysAgoISO(4), details: 'Circular routing eligibility confirmed', status: 'active' },
      { event: 'Buyer Matching', timestamp: '', details: 'Finding optimal nearby buyer', status: 'pending' },
    ];
  }

  // routed or reallocated
  const fullHistory: HistoryEntry[] = [
    ...baseHistory,
    { event: 'Arrived at Hub', timestamp: daysAgoISO(6), details: `Package received at ${HUBS[CITIES[index % CITIES.length]!]}`, status: 'completed' },
    { event: 'AI Analysis Complete', timestamp: daysAgoISO(5), details: 'Product condition verified. Eligibility score generated.', status: 'completed' },
    { event: 'Buyer Matched', timestamp: daysAgoISO(4), details: 'Reserved buyer identified within delivery radius', status: 'completed' },
  ];

  if (status === 'routed') {
    fullHistory.push(
      { event: 'Package Relabeled', timestamp: daysAgoISO(3), details: 'New shipping label generated for circular delivery', status: 'completed' },
      { event: 'Dispatched to New Buyer', timestamp: daysAgoISO(2), details: 'Package sent directly from hub to new buyer', status: 'active' },
    );
  } else {
    fullHistory.push(
      { event: 'Package Relabeled', timestamp: daysAgoISO(3), details: 'New shipping label generated for circular delivery', status: 'completed' },
      { event: 'Dispatched to New Buyer', timestamp: daysAgoISO(2), details: 'Package sent directly from hub to new buyer', status: 'completed' },
      { event: 'Delivered to New Buyer', timestamp: daysAgoISO(1), details: 'Successfully delivered. Circular routing complete.', status: 'completed' },
    );
  }

  return fullHistory;
}

function generatePassports(): PassportSeed[] {
  const passports: PassportSeed[] = [];

  // Status distribution: 12 routed/reallocated, 5 at_hub, 3 return_initiated
  const statuses: Array<'routed' | 'reallocated' | 'at_hub' | 'return_initiated'> = [
    'reallocated', 'reallocated', 'reallocated', 'reallocated', 'reallocated', 'reallocated',
    'routed', 'routed', 'routed', 'routed', 'routed', 'routed',
    'at_hub', 'at_hub', 'at_hub', 'at_hub', 'at_hub',
    'return_initiated', 'return_initiated', 'return_initiated',
  ];

  const conditions: Array<'new' | 'like_new' | 'good' | 'fair'> = [
    'like_new', 'like_new', 'good', 'like_new', 'like_new', 'good',
    'like_new', 'good', 'like_new', 'good', 'like_new', 'like_new',
    'good', 'like_new', 'good', 'fair', 'like_new',
    'good', 'fair', 'fair',
  ];

  const scores = [
    95, 92, 88, 97, 91, 85, 93, 78, 96, 82, 89, 94,
    87, 90, 83, 52, 91,
    76, 48, 55,
  ];

  for (let i = 0; i < 20; i++) {
    const idx = i + 1;
    const product = PRODUCTS[i]!;
    const city = CITIES[i % CITIES.length]!;
    const status = statuses[i]!;
    const owner = OWNERS[i]!;
    const buyer = BUYERS[i % BUYERS.length]!;

    const passport: PassportSeed = {
      passportId: `PP-${1000 + idx}`,
      qrCodeValue: `CIRCULAR-PP-${1000 + idx}`,
      sku: product.sku,
      productName: product.name,
      category: product.category,
      condition: conditions[i]!,
      currentOwner: owner,
      currentLocation: { city, hub: HUBS[city]! },
      currentStatus: status,
      eligibilityScore: scores[i]!,
      reservedBuyer: (status === 'routed' || status === 'reallocated' || status === 'at_hub') ? buyer : null,
      ownershipHistory: [
        { owner: 'Amazon Warehouse', from: 'Fulfillment Center', to: city, date: daysAgoISO(14) },
        { owner, from: city, to: city, date: daysAgoISO(10) },
        ...(status === 'reallocated' ? [{ owner: buyer.name, from: city, to: buyer.city, date: daysAgoISO(1) }] : []),
      ],
      returnHistory: [
        {
          reason: ['Size mismatch', 'Changed mind', 'Found better price', 'Not as expected', 'Duplicate order'][i % 5]!,
          date: daysAgoISO(8),
          condition: conditions[i]!,
        },
      ],
      routingHistory: generateRoutingHistory(status, i),
    };

    passports.push(passport);
  }

  return passports;
}

export async function seedPassports(): Promise<number> {
  await ProductPassport.deleteMany({});
  const passports = generatePassports();
  await ProductPassport.insertMany(passports);
  return passports.length;
}
