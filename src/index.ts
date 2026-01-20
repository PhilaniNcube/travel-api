import { Hono } from 'hono'
import { auth } from './lib/auth'
import activitiesRoute from './routes/activities'
import packagesRoute from './routes/packages'
import bookingsRoute from './routes/bookings'

const app = new Hono()

app
.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
.route('/api/activities', activitiesRoute)
.route('/api/packages', packagesRoute)
.route('/api/bookings', bookingsRoute)
.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
