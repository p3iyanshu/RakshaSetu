/**
 * Mock fleet + accident-history data for the admin console.
 *
 * Static demo data (no backend, consistent with the rest of this
 * dashboard) — three of these vehicle numbers map onto the vehicles the
 * live worldModel simulation actually tracks (via trackId, matching
 * worldModel.js's dynamicVehicles #04/#18/#26) so the Detection Panel has
 * something live to show; the rest have trackId: null to demonstrate the
 * "not currently in perception range" state.
 */

export const VEHICLES = [
  {
    vehicleNumber: 'RJ14 GA 2024',
    trackId: '04',
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
    trackId: '18',
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
    trackId: '26',
    make: 'Mahindra Bolero',
    color: 'Silver',
    accidents: []
  },
  {
    vehicleNumber: 'RJ09 KL 1187',
    trackId: null,
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
    trackId: null,
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
