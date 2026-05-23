<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Reservations\Domain\Model\Hold;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Reservations\Domain\Exception\InvalidArgument;
use Frontstage\Reservations\Domain\Model\Hold\Hold;
use Frontstage\Reservations\Domain\Model\Hold\HoldId;
use Frontstage\Reservations\Domain\Model\Hold\HoldSeat;
use PHPUnit\Framework\TestCase;

final class HoldTest extends TestCase
{
	private function id(): HoldId
	{
		return HoldId::fromString('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
	}

	private function utc(string $iso): DateTimeImmutable
	{
		return new DateTimeImmutable($iso, new DateTimeZone('UTC'));
	}

	public function testPlaceComputesExpiryFromNowPlusTtl(): void
	{
		$hold = Hold::place(
			$this->id(),
			'event-1',
			[HoldSeat::of('A', '1', '1')],
			$this->utc('2026-01-01T00:00:00+00:00'),
			600,
		);

		$this->assertSame('2026-01-01T00:10:00+00:00', $hold->expiresAt->format(DATE_ATOM));
	}

	public function testPlaceRequiresAtLeastOneSeat(): void
	{
		$this->expectException(InvalidArgument::class);
		Hold::place($this->id(), 'event-1', [], $this->utc('2026-01-01T00:00:00+00:00'), 600);
	}

	public function testPlaceRejectsDuplicateSeats(): void
	{
		$this->expectException(InvalidArgument::class);
		Hold::place(
			$this->id(),
			'event-1',
			[HoldSeat::of('A', '1', '1'), HoldSeat::of('A', '1', '1')],
			$this->utc('2026-01-01T00:00:00+00:00'),
			600,
		);
	}

	public function testPlaceRequiresPositiveTtl(): void
	{
		$this->expectException(InvalidArgument::class);
		Hold::place($this->id(), 'event-1', [HoldSeat::of('A', '1', '1')], $this->utc('2026-01-01T00:00:00+00:00'), 0);
	}

	public function testIsExpiredAfterExpiry(): void
	{
		$hold = Hold::place(
			$this->id(),
			'event-1',
			[HoldSeat::of('A', '1', '1')],
			$this->utc('2026-01-01T00:00:00+00:00'),
			60,
		);

		$this->assertFalse($hold->isExpired($this->utc('2026-01-01T00:00:30+00:00')));
		$this->assertTrue($hold->isExpired($this->utc('2026-01-01T00:01:00+00:00')));
		$this->assertTrue($hold->isExpired($this->utc('2026-01-01T00:05:00+00:00')));
	}

	public function testTtlSecondsFromShrinksAsTimeAdvances(): void
	{
		$hold = Hold::place(
			$this->id(),
			'event-1',
			[HoldSeat::of('A', '1', '1')],
			$this->utc('2026-01-01T00:00:00+00:00'),
			600,
		);

		$this->assertSame(600, $hold->ttlSecondsFrom($this->utc('2026-01-01T00:00:00+00:00')));
		$this->assertSame(300, $hold->ttlSecondsFrom($this->utc('2026-01-01T00:05:00+00:00')));
		// Floored at 1 second so storage TTLs never round to "evict immediately".
		$this->assertSame(1, $hold->ttlSecondsFrom($this->utc('2026-01-01T00:11:00+00:00')));
	}
}
