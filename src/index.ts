import { Hono } from 'hono'
import { auth } from './lib/auth'
import activitiesRoute from './routes/activities'
import packagesRoute from './routes/packages'
import bookingsRoute from './routes/bookings'
import paymentsRoute from './routes/payments'
import reviewsRoute from './routes/reviews'

const app = new Hono()

app
.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
.route('/api/webhooks', paymentsRoute) // Webhook routes (no auth)
.route('/api/activities', activitiesRoute)
.route('/api/packages', packagesRoute)
.route('/api/bookings', bookingsRoute)
.route('/api/payments', paymentsRoute)
.route('/api/reviews', reviewsRoute)
.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
