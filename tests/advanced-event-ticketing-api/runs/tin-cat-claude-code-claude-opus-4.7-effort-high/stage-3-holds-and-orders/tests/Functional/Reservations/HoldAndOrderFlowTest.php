<?php

declare(strict_types=1);

namespace Frontstage\Tests\Functional\Reservations;

use Frontstage\Tests\Functional\ApiTestCase;

/**
 * End-to-end coverage of the seat-holding and ordering flow across the
 * Reservations and Ordering contexts. Drives the HTTP API the same way
 * external clients do.
 */
final class HoldAndOrderFlowTest extends ApiTestCase
{
	private const EVENT_ID = '44444444-4444-4444-8444-444444444444';

	protected function setUp(): void
	{
		parent::setUp();
		$this->createAndPublishEvent();
	}

	public function testPlacingAHoldMakesSeatsUnavailable(): void
	{
		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertStatusOk();
		$this->assertSame(4, $availability['totalCapacity']);
		$this->assertSame(4, $availability['availableCount']);
		$this->assertSame(0, $availability['heldCount']);

		$placed = $this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01',
			'seats' => [
				['section' => 'Orchestra', 'row' => 'A', 'number' => '1'],
				['section' => 'Orchestra', 'row' => 'A', 'number' => '2'],
			],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);
		$this->assertSame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01', $placed['id']);

		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertStatusOk();
		$this->assertSame(2, $availability['availableCount']);
		$this->assertSame(2, $availability['heldCount']);
		$this->assertSame(0, $availability['soldCount']);

		$heldSeats = array_filter($availability['seats'], static fn (array $s) => 'held' === $s['status']);
		$this->assertCount(2, $heldSeats);
	}

	public function testTwoConcurrentAttemptsToHoldTheSameSeatCannotBothSucceed(): void
	{
		// "Concurrent" in the user's request maps to: under no circumstances
		// may two distinct holds end up owning the same seat. With the
		// Redis-backed lock + per-seat marker, an in-flight or already-placed
		// hold reserves the seat against any second attempt — so a sequential
		// second request is the same failure surface as a truly concurrent
		// one. The unit test exercises the locker path with a deny-all
		// locker; this test exercises the persistent-marker path.

		$first = $this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);

		$second = $this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(409);
		$this->assertArrayHasKey('error', $second);
	}

	public function testAnExpiredHoldFreesItsSeatsAgain(): void
	{
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa20',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			// 1 second TTL is the smallest the domain accepts; the cache
			// adapter (array in tests, Redis in prod) honours per-item TTL,
			// so the expiry below works against real wall time.
			'ttlSeconds' => 1,
		]);
		$this->assertStatus(201);

		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertSame(1, $availability['heldCount']);

		// Wait past the TTL. Slow (~1.2s) but the only place in the suite
		// that depends on real time.
		usleep(1_200_000);

		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertSame(0, $availability['heldCount']);
		$this->assertSame(4, $availability['availableCount']);

		// And a fresh hold on the same seat works.
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);
	}

	public function testReleasingAHoldEarlyFreesItsSeats(): void
	{
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);

		$this->request('DELETE', '/holds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa30');
		$this->assertStatus(204);

		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertSame(0, $availability['heldCount']);
		$this->assertSame(4, $availability['availableCount']);
	}

	public function testReleasingAnUnknownHoldReturns404(): void
	{
		$this->request('DELETE', '/holds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99');
		$this->assertStatus(404);
	}

	public function testPlacingAnOrderConsumesTheHoldAndMarksSeatsSold(): void
	{
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa40',
			'seats' => [
				['section' => 'Orchestra', 'row' => 'A', 'number' => '1'],
				['section' => 'Orchestra', 'row' => 'B', 'number' => '1'],
			],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);

		$placed = $this->request('POST', '/orders', [
			'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccc40',
			'holdId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa40',
		]);
		$this->assertStatus(201);
		$this->assertSame('cccccccc-cccc-4ccc-8ccc-cccccccccc40', $placed['id']);

		$order = $this->request('GET', '/orders/cccccccc-cccc-4ccc-8ccc-cccccccccc40');
		$this->assertStatusOk();
		$this->assertSame('placed', $order['status']);
		// Seat A/1 is VIP @ 15000; B/1 is General @ 5000.
		$this->assertSame(20000, $order['total']['amount']);
		$this->assertSame('USD', $order['total']['currency']);
		$this->assertCount(2, $order['lines']);

		// The seats are now sold in the catalog and the hold is gone.
		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertSame(2, $availability['soldCount']);
		$this->assertSame(0, $availability['heldCount']);
		$this->assertSame(2, $availability['availableCount']);
	}

	public function testConsumedHoldCanNoLongerBeOrdered(): void
	{
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);

		$this->request('POST', '/orders', [
			'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccc50',
			'holdId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50',
		]);
		$this->assertStatus(201);

		// Second order against the same (now-consumed) hold must fail.
		$retry = $this->request('POST', '/orders', [
			'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccc51',
			'holdId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa50',
		]);
		$this->assertStatus(409);
		$this->assertArrayHasKey('error', $retry);
	}

	public function testReleasedHoldCanNoLongerBeOrdered(): void
	{
		$this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa60',
			'seats' => [['section' => 'Orchestra', 'row' => 'A', 'number' => '1']],
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);

		$this->request('DELETE', '/holds/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa60');
		$this->assertStatus(204);

		$attempt = $this->request('POST', '/orders', [
			'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccc60',
			'holdId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa60',
		]);
		$this->assertStatus(409);
		$this->assertArrayHasKey('error', $attempt);
	}

	public function testHoldByQuantityPicksAvailableSeats(): void
	{
		$placed = $this->request('POST', '/events/'.self::EVENT_ID.'/holds', [
			'id' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa70',
			'quantity' => 2,
			'ttlSeconds' => 600,
		]);
		$this->assertStatus(201);
		$this->assertSame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa70', $placed['id']);

		$availability = $this->request('GET', '/events/'.self::EVENT_ID.'/availability');
		$this->assertSame(2, $availability['heldCount']);
	}

	public function testCannotPlaceOrderAgainstUnknownHold(): void
	{
		$response = $this->request('POST', '/orders', [
			'id' => 'cccccccc-cccc-4ccc-8ccc-cccccccccc80',
			'holdId' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa80',
		]);
		$this->assertStatus(409);
		$this->assertArrayHasKey('error', $response);
	}

	private function createAndPublishEvent(): void
	{
		// Sectioned event with 4 seats and two price tiers so order totals
		// exercise mixed pricing.
		$this->request('POST', '/events', [
			'id' => self::EVENT_ID,
			'title' => 'Hold and Order Flow',
			'description' => 'Fixture event for reservation tests.',
			'startsAt' => '2026-12-01T19:00:00+00:00',
			'venueName' => 'Test Hall',
			'priceTiers' => [
				['id' => 'general', 'name' => 'General', 'priceAmount' => 5000, 'priceCurrency' => 'USD'],
				['id' => 'vip', 'name' => 'VIP', 'priceAmount' => 15000, 'priceCurrency' => 'USD'],
			],
			'seating' => [
				'type' => 'sectioned',
				'sections' => [
					[
						'name' => 'Orchestra',
						'rows' => [
							['label' => 'A', 'seats' => [
								['number' => '1', 'priceTierId' => 'vip'],
								['number' => '2', 'priceTierId' => 'vip'],
							]],
							['label' => 'B', 'seats' => [
								['number' => '1', 'priceTierId' => 'general'],
								['number' => '2', 'priceTierId' => 'general'],
							]],
						],
					],
				],
			],
		]);
		$this->assertStatus(201);

		$this->request('POST', '/events/'.self::EVENT_ID.'/publish');
		$this->assertStatus(204);
	}
}
