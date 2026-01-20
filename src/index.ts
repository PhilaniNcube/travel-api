import { Hono } from 'hono'
import { auth } from './lib/auth'
import activitiesRoute from './routes/activities'

const app = new Hono()

app
.on(['POST', 'GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))
.route('/api/activities', activitiesRoute)
.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default app
