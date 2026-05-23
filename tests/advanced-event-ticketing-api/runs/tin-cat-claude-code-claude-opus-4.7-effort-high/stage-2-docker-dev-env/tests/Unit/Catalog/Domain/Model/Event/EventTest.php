<?php

declare(strict_types=1);

namespace Frontstage\Tests\Unit\Catalog\Domain\Model\Event;

use Frontstage\Catalog\Domain\Exception\InvalidArgument;
use Frontstage\Catalog\Domain\Exception\InvalidEventState;
use Frontstage\Catalog\Domain\Model\Event\Event;
use Frontstage\Catalog\Domain\Model\Event\EventDescription;
use Frontstage\Catalog\Domain\Model\Event\EventId;
use Frontstage\Catalog\Domain\Model\Event\EventStatus;
use Frontstage\Catalog\Domain\Model\Event\EventTitle;
use Frontstage\Catalog\Domain\Model\Event\StartsAt;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTier;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierId;
use Frontstage\Catalog\Domain\Model\PriceTier\PriceTierName;
use Frontstage\Catalog\Domain\Model\Shared\Currency;
use Frontstage\Catalog\Domain\Model\Shared\Money;
use Frontstage\Catalog\Domain\Model\Venue\GeneralAdmissionSeating;
use Frontstage\Catalog\Domain\Model\Venue\Row;
use Frontstage\Catalog\Domain\Model\Venue\Seat;
use Frontstage\Catalog\Domain\Model\Venue\SeatId;
use Frontstage\Catalog\Domain\Model\Venue\Section;
use Frontstage\Catalog\Domain\Model\Venue\SectionedSeating;
use Frontstage\Catalog\Domain\Model\Venue\Venue;
use Frontstage\Catalog\Domain\Model\Venue\VenueName;
use PHPUnit\Framework\TestCase;

final class EventTest extends TestCase
{
	public function testCreateDraftEventWithSectionedSeating(): void
	{
		$general = PriceTierId::of('general');
		$vip = PriceTierId::of('vip');

		$event = Event::create(
			EventId::fromString('11111111-1111-4111-8111-111111111111'),
			EventTitle::of('Symphony Night'),
			EventDescription::of('An evening of music.'),
			StartsAt::fromIsoString('2026-09-12T19:30:00+00:00'),
			new Venue(
				VenueName::of('Grand Hall'),
				new SectionedSeating([
					new Section('Orchestra', [
						new Row('A', [
							new Seat(SeatId::of('Orchestra', 'A', '1'), $vip),
							new Seat(SeatId::of('Orchestra', 'A', '2'), $vip),
						]),
						new Row('B', [
							new Seat(SeatId::of('Orchestra', 'B', '1'), $general),
						]),
					]),
				]),
			),
			[
				new PriceTier($vip, PriceTierName::of('VIP'), Money::of(15000, Currency::of('USD'))),
				new PriceTier($general, PriceTierName::of('General'), Money::of(5000, Currency::of('USD'))),
			],
		);

		$this->assertSame(EventStatus::Draft, $event->status());
		$this->assertSame(3, $event->venue()->seating->totalCapacity());
		$this->assertSame(3, $event->availableSeatCount());
		$this->assertCount(2, $event->priceTiers());
	}

	public function testCreateRejectsSeatReferencingUnknownPriceTier(): void
	{
		$known = PriceTierId::of('general');
		$ghost = PriceTierId::of('phantom');

		$this->expectException(InvalidArgument::class);
		$this->expectExceptionMessage('Seating references undefined price tier "phantom"');

		Event::create(
			EventId::fromString('22222222-2222-4222-8222-222222222222'),
			EventTitle::of('Test'),
			EventDescription::of(''),
			StartsAt::fromIsoString('2026-09-12T19:30:00+00:00'),
			new Venue(
				VenueName::of('Hall'),
				new SectionedSeating([
					new Section('Main', [
						new Row('1', [new Seat(SeatId::of('Main', '1', '1'), $ghost)]),
					]),
				]),
			),
			[new PriceTier($known, PriceTierName::of('General'), Money::of(0, Currency::of('USD')))],
		);
	}

	public function testCreateRejectsWithoutPriceTiers(): void
	{
		$this->expectException(InvalidArgument::class);

		Event::create(
			EventId::fromString('33333333-3333-4333-8333-333333333333'),
			EventTitle::of('Test'),
			EventDescription::of(''),
			StartsAt::fromIsoString('2026-09-12T19:30:00+00:00'),
			new Venue(
				VenueName::of('Hall'),
				new GeneralAdmissionSeating(50, PriceTierId::of('general')),
			),
			[],
		);
	}

	public function testCreateRejectsDuplicatePriceTierIds(): void
	{
		$tierId = PriceTierId::of('general');

		$this->expectException(InvalidArgument::class);
		$this->expectExceptionMessage('Duplicate price tier id "general"');

		Event::create(
			EventId::fromString('44444444-4444-4444-8444-444444444444'),
			EventTitle::of('Test'),
			EventDescription::of(''),
			StartsAt::fromIsoString('2026-09-12T19:30:00+00:00'),
			new Venue(
				VenueName::of('Hall'),
				new GeneralAdmissionSeating(10, $tierId),
			),
			[
				new PriceTier($tierId, PriceTierName::of('A'), Money::of(100, Currency::of('USD'))),
				new PriceTier($tierId, PriceTierName::of('B'), Money::of(200, Currency::of('USD'))),
			],
		);
	}

	public function testPublishMovesFromDraftToPublished(): void
	{
		$event = $this->draftGaEvent();
		$this->assertSame(EventStatus::Draft, $event->status());

		$event->publish();

		$this->assertSame(EventStatus::Published, $event->status());
	}

	public function testPublishTwiceFails(): void
	{
		$event = $this->draftGaEvent();
		$event->publish();

		$this->expectException(InvalidEventState::class);
		$event->publish();
	}

	public function testGeneralAdmissionMaterializesCapacityAsSeats(): void
	{
		$event = $this->draftGaEvent();

		$this->assertSame(20, $event->availableSeatCount());
		$this->assertSame(20, $event->venue()->seating->totalCapacity());
	}

	private function draftGaEvent(): Event
	{
		$tier = PriceTierId::of('general');

		return Event::create(
			EventId::fromString('55555555-5555-4555-8555-555555555555'),
			EventTitle::of('Open Mic'),
			EventDescription::of(''),
			StartsAt::fromIsoString('2026-10-01T20:00:00+00:00'),
			new Venue(VenueName::of('Basement'), new GeneralAdmissionSeating(20, $tier)),
			[new PriceTier($tier, PriceTierName::of('General'), Money::of(1000, Currency::of('USD')))],
		);
	}
}
