#include <xc.inc>
#include <pic16f1507.inc>

#define skpz BTFSS STATUS, STATUS_ZERO_POSITION
#define skpnz BTFSC STATUS, STATUS_ZERO_POSITION
#define skpc BTFSS STATUS, STATUS_CARRY_POSITION
#define skpnc BTFSC STATUS, STATUS_CARRY_POSITION

config FOSC = INTOSC, WDTE = OFF, PWRTE = ON, MCLRE = ON, CP = OFF, BOREN = ON, CLKOUTEN = OFF
config WRT = OFF, STVREN = ON, BORV = LO, LPBOR = OFF, LVP = OFF

;*******************************************************************************
; Reset Vector
;*******************************************************************************

PSECT resetVector,delta=2,class=CODE	; processor reset vector
    goto    start			; go to beginning of program

;*******************************************************************************
; MAIN PROGRAM
;*******************************************************************************

PSECT udata_shr
flowBad: DS 1 ; nonzero if flow low or pump not running
pumpTimer: DS 1 ; counts down to zero while pumps are on
flowTimer: DS 1 ; counts down to zero while flow is low

#define LOW_FLOW_SECS 2
#define CHEM_PUMP_SECS 60
#define MIN_FLOW_HZ 10

PSECT code              ; let linker place main program
 
start:
    ; internal osc at 250khz
    banksel OSCCON
    movlw 00110000B
    movwf OSCCON
    
    banksel LATA
    clrf LATA
    banksel TRISA
    movlw 00110000B
    movwf TRISA
    banksel ANSELA
    clrf ANSELA
    banksel WPUA
    movwf WPUA
    
    banksel LATB
    clrf LATB
    banksel TRISB
    movlw 01110000B
    movwf TRISB
    banksel ANSELB
    clrf ANSELB
    banksel WPUB
    movwf WPUB
    
    banksel LATC
    clrf LATC
    banksel TRISC
    movlw 00000000B
    movwf TRISC
    banksel ANSELC
    clrf ANSELC
    
    ; Timer 0 overflows once per second
    banksel OPTION_REG
    movlw 00000111B
    movwf OPTION_REG
    
    ; Timer 1 counts flow pulses
    banksel T1CON
    movlw 10000000B
    movwf T1CON
    
    movlw LOW_FLOW_SECS
    movwf flowTimer
    movlw CHEM_PUMP_SECS
    movwf pumpTimer
    
mainLoop:
    ; timer 1 is off. clear it
    banksel T1CON
    clrf TMR1L
    clrf TMR1H
    bsf T1CON, 0
    
    ; clear timer 0
    banksel TMR0
    clrf TMR0
    banksel INTCON
    bcf INTCON, 2

    ; delay until 1 second has expired
delay:
    btfss INTCON, 2
    goto delay
    
    ; stop timer 1
    banksel T1CON
    bcf T1CON, 0
    
    ; compare timer 1 to flow limit
    banksel TMR1H
    movf TMR1H
    skpz
    goto goodFlow
    
    movf TMR1L, w
    addlw 0xff - MIN_FLOW_HZ
    skpnc
    goto goodFlow
    
    banksel LATC
    bcf LATC, 1 ; indicates flow is bad
    
    ; flow is low. decrement timer
    decfsz flowTimer
    goto flowTimerOK
    
    incf flowTimer
    ; timer ran out.
    movlw 1
    movwf flowBad
    goto checkLogic
    
goodFlow:
    banksel LATC
    bsf LATC, 1
    movlw LOW_FLOW_SECS
    movwf flowTimer
    
flowTimerOK:
    movlw 0
    movwf flowBad
    
checkLogic:
    ; logic:
    ; error if
    ; (flow lower than limit for more than time limit, OR circulation pump off)
    ; AND at least one chemical pump is on
    banksel PORTB
    movlw 1
    btfsc PORTA, 4 ; circulation pump
    movwf flowBad
    
    movlw 0
    btfss PORTB, 4 ; chlorine pump
    addlw 1
    btfss PORTB, 5 ; acid pump
    addlw 1
    btfss PORTB, 6 ; base pump
    addlw 1
    
    addlw 0
    skpz
    goto chemicalPumpOn
    movlw CHEM_PUMP_SECS
    movwf pumpTimer
    goto mainLoop ; no pumps on; just loop again
    
chemicalPumpOn:
    decf pumpTimer
    skpnz
    goto fail

    addwf flowBad, w
    ; check if more than 1
    addlw 0xfe
    skpc
    goto mainLoop
    
fail:
    ; set fail output
    banksel LATC
    bsf LATC, 0
    bcf LATC, 1
    
deadLoop:
    goto deadLoop

    END