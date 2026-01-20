import { Hono } from 'hono'
import { auth } from './lib/auth'
import activitiesRoute from './routes/activities'
import packagesRoute from './routes/packages'

const app = new Hono()

app
.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
.route('/api/activities', activitiesRoute)
.route('/api/packages', packagesRoute)
.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
