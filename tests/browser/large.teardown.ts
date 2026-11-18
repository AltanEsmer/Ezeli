// After every test that uses the large archive has finished (pass or fail), it is removed, so the
// import tests that read the same stack are not slowed or confused by it.
import { test } from '@playwright/test'
import wipe from './wipe.ts'

test('the large made-up archive is removed', async () => {
  test.setTimeout(300_000)
  await wipe()
})
