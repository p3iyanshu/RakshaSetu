/**
 * Mock fleet + accident-history data for the admin console.
 *
 * Static demo data (no backend, consistent with the rest of this dashboard).
 * Each ON ROAD vehicle drives the same mountain loop as the main dashboard,
 * starting `routeOffsetM` metres along it, so selecting it in the admin
 * console shows its own live telemetry and LiDAR feed. PARKED vehicles hold
 * still at `routeOffsetM` with no live motion.
 */

export const VEHICLES = [
  {
    vehicleNumber: 'RJ14 GA 2024',
    status: 'ON ROAD',
    routeOffsetM: 0,
    make: 'Maruti Suzuki Swift',
    color: 'White',
    accidents: [
      {
        date: '2025-11-02',
        cause: 'Rear-end collision at signal — driver distraction, failed to brake in time',
        severity: 'Minor',
        location: 'MI Road, Jaipur'
      },
      {
        date: '2024-06-18',
        cause: 'Skidded on wet road during monsoon — loss of traction on a curve',
        severity: 'Moderate',
        location: 'Tonk Road, Jaipur'
      }
    ]
  },
  {
    vehicleNumber: 'RJ14 CV 8871',
    status: 'ON ROAD',
    routeOffsetM: 460,
    make: 'Tata Ace (Light Commercial)',
    color: 'Blue',
    accidents: [
      {
        date: '2025-03-27',
        cause: 'Sideswiped while overtaking — misjudged gap in adjacent lane',
        severity: 'Moderate',
        location: 'Ajmer Road, Jaipur'
      }
    ]
  },
  {
    vehicleNumber: 'RJ14 EF 5539',
    status: 'ON ROAD',
    routeOffsetM: 920,
    make: 'Mahindra Bolero',
    color: 'Silver',
    accidents: []
  },
  {
    vehicleNumber: 'RJ09 KL 1187',
    status: 'PARKED',
    routeOffsetM: 700,
    make: 'Hyundai i20',
    color: 'Red',
    accidents: [
      {
        date: '2025-08-14',
        cause: 'Pothole impact caused tyre blowout and loss of control',
        severity: 'Moderate',
        location: 'Sikar Road, Jaipur'
      },
      {
        date: '2023-12-05',
        cause: 'Collided with static roadside pole while parking',
        severity: 'Minor',
        location: 'C-Scheme, Jaipur'
      }
    ]
  },
  {
    vehicleNumber: 'RJ02 BT 4420',
    status: 'PARKED',
    routeOffsetM: 1180,
    make: 'Ashok Leyland Dost',
    color: 'White',
    accidents: [
      {
        date: '2024-09-30',
        cause: 'Pedestrian crossed outside marked zone — emergency braking, minor impact',
        severity: 'Severe',
        location: 'Station Road, Jaipur'
      }
    ]
  }
];
