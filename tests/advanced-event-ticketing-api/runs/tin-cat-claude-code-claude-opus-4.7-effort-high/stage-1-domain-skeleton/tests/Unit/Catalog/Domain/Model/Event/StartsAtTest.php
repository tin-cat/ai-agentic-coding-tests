<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Catalog\Domain\Model\Event;

use DateTimeImmutable;
use DateTimeZone;
use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Model\Event\StartsAt;
use PHPUnit\Framework\TestCase;

final class StartsAtTest extends TestCase
{
	public function testParsesIsoStringInUtc(): void
	{
		$startsAt = StartsAt::fromIsoString('2026-07-01T19:00:00+00:00');

		$this->assertSame('UTC', $startsAt->value->getTimezone()->getName());
		$this->assertSame('2026-07-01T19:00:00+00:00', $startsAt->toIsoString());
	}

	public function testNormalizesOffsetToUtc(): void
	{
		$startsAt = StartsAt::fromIsoString('2026-07-01T21:00:00+02:00');

		$this->assertSame('UTC', $startsAt->value->getTimezone()->getName());
		$this->assertSame('2026-07-01T19:00:00+00:00', $startsAt->toIsoString());
	}

	public function testRejectsMalformedIso(): void
	{
		$this->expectException(InvalidArgument::class);
		StartsAt::fromIsoString('not-a-date');
	}

	public function testFromDateTimeRequiresUtc(): void
	{
		$this->expectException(InvalidArgument::class);
		StartsAt::fromDateTime(new DateTimeImmutable('2026-07-01 19:00:00', new DateTimeZone('America/New_York')));
	}
}
