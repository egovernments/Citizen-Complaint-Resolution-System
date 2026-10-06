package org.egov.pgr.web.models.pgrV1;

import org.egov.pgr.annotation.SafeHtml;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import jakarta.validation.constraints.Email;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

@NoArgsConstructor
@AllArgsConstructor
@Data
public class Citizen {

	private Long id;
	@SafeHtml
	private String uuid;
	
//	@Pattern(regexp="^[a-zA-Z. ]*$")
	@Size(max=30)
	@SafeHtml
	private String name;
	
	@JsonProperty("permanentAddress")
	//@Pattern(regexp = "^[a-zA-Z0-9!@#.,/: ()&'-]*$")
	@Size(max=160)
	@SafeHtml
	private String address;
	
//	@Pattern(regexp="(^$|[0-9]{10})")
	@SafeHtml
	private String mobileNumber;
	
	@SafeHtml
	private String aadhaarNumber;
	@SafeHtml
	private String pan;
	
	@Email
	@SafeHtml
	private String emailId;
	@SafeHtml
	private String userName;
	private String password;
	private Boolean active;
	private UserType type;
	private Gender gender;
	@SafeHtml
	private String tenantId; 
	
	@JsonProperty("roles")
    private List<Role> roles;
}
