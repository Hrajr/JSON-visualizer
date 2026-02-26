/**
 * Generate sample data in the concatenated-JSON format.
 */

const SAMPLE_KEYS = [
  'id', 'name', 'email', 'age', 'city', 'country', 'phone',
  'company', 'role', 'department', 'salary', 'startDate',
  'active', 'score', 'level', 'bio', 'website', 'tags',
  'address', 'zip',
]

const CITIES = ['New York', 'London', 'Tokyo', 'Berlin', 'Sydney', 'Paris', 'Toronto']
const COMPANIES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella', 'Cyberdyne', 'Stark Industries']
const ROLES = ['Engineer', 'Manager', 'Analyst', 'Designer', 'Director', 'VP']
const DEPTS = ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations']

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomRecord(index: number): Record<string, unknown> {
  return {
    id: index,
    name: `User_${index}`,
    email: `user${index}@example.com`,
    age: 20 + Math.floor(Math.random() * 45),
    city: randomItem(CITIES),
    country: 'US',
    phone: `+1-555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    company: randomItem(COMPANIES),
    role: randomItem(ROLES),
    department: randomItem(DEPTS),
    salary: Math.floor(Math.random() * 150000) + 50000,
    startDate: `202${Math.floor(Math.random() * 6)}-0${Math.floor(Math.random() * 9) + 1}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    active: Math.random() > 0.2,
    score: Math.round(Math.random() * 100) / 10,
    level: Math.floor(Math.random() * 10) + 1,
    bio: `This is a short bio for user ${index}. They work at ${randomItem(COMPANIES)}.`,
    website: `https://user${index}.example.com`,
    tags: [randomItem(['vip', 'new', 'legacy', 'premium']), randomItem(['tier1', 'tier2', 'tier3'])].join(', '),
    address: `${Math.floor(Math.random() * 9999) + 1} Main St`,
    zip: String(Math.floor(Math.random() * 90000) + 10000),
  }
}

/**
 * Generate sample concatenated JSON text with the given number of records.
 */
export function generateSampleText(count: number): string {
  const parts: string[] = []
  for (let i = 0; i < count; i++) {
    parts.push(JSON.stringify(randomRecord(i), null, 2))
  }
  return parts.join('\n')
}

/**
 * Generate a File object with sample data.
 */
export function generateSampleFile(count: number = 500): File {
  const text = generateSampleText(count)
  const blob = new Blob([text], { type: 'text/plain' })
  return new File([blob], `sample_${count}_records.txt`, { type: 'text/plain' })
}
